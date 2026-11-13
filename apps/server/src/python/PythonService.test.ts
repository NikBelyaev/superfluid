import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workspace } from '../workspace/Workspace';
import { repository, temp, terminalWorker, pythonProbe } from '../../../../tests/fixtures';
import type { Input, Results } from '@superfluid/contracts';

test('Python imports use the current buffer, nested Ruff settings and safe fixes', async () => {
  const root = await repository();
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested/ruff.toml'), '[lint.isort]\nforce-single-line = true\n');
  const disk = 'print("disk version")\n';
  await writeFile(join(root, 'nested/main.py'), disk);
  const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
  const originalPath = process.env.PATH;
  try {
    const project = await workspace.projects.add(root);
    const [session] = await workspace.projects.sessions(project.id);
    const bin = await temp();
    await writeFile(
      join(bin, 'ruff'),
      '#!/bin/sh\necho "External Ruff must not run" >&2\nexit 99\n',
      { mode: 0o755 },
    );
    process.env.PATH = bin + delimiter + originalPath;
    assert.equal(
      await workspace.call('python.format', { sessionId: session.id, text: 'value=1\n' }),
      'value = 1\n',
    );
    const text = [
      'from os import path, environ',
      'import sys',
      'import json  # noqa: F401',
      'from math import sqrt as sqrt',
      '',
      'print( path, sys.version )',
      '',
    ].join('\n');
    const input = { sessionId: session.id, path: 'nested/main.py', text };
    const unusedImports = (input: Input<'python.organizeImports'>) =>
      workspace.python.unusedImports(session, input);
    const unused = await unusedImports(input);
    assert.deepEqual(
      unused.map((d) => d.range),
      [{ start: { line: 0, character: 21 }, end: { line: 0, character: 28 } }],
    );
    const optimized = await workspace.call('python.organizeImports', input);
    assert.equal(
      optimized,
      [
        'import json  # noqa: F401',
        'import sys',
        'from math import sqrt as sqrt',
        'from os import path',
        '',
        'print( path, sys.version )',
        '',
      ].join('\n'),
    );
    assert.deepEqual(await unusedImports({ ...input, text: optimized }), []);
    assert.equal(await readFile(join(root, input.path), 'utf8'), disk);
    const bom = '\ufeffimport sys\r\nimport os\r\n\r\nprint(sys.version)\r\n';
    assert.equal(
      await workspace.call('python.organizeImports', { ...input, text: bom }),
      '\ufeffimport sys\r\n\r\nprint(sys.version)\r\n',
    );
    const unicode = 'label = "😀"; from os import path as путь, environ\nprint(путь)\n';
    assert.deepEqual(
      (await unusedImports({ ...input, text: unicode })).map((d) => d.range),
      [
        {
          start: { line: 0, character: unicode.indexOf('environ') },
          end: { line: 0, character: unicode.indexOf('environ') + 7 },
        },
      ],
    );
    await writeFile(
      join(root, 'nested/ruff.toml'),
      '[lint.per-file-ignores]\n"main.py" = ["F401"]\n',
    );
    assert.deepEqual(await unusedImports(input), []);
    assert.match(await workspace.call('python.organizeImports', input), /environ/);
    await mkdir(join(root, 'pkg'));
    await writeFile(join(root, 'pkg/__init__.py'), '');
    assert.equal(
      await workspace.call('python.organizeImports', {
        ...input,
        path: 'pkg/__init__.py',
        text: 'import os\n',
      }),
      'import os\n',
    );
    await assert.rejects(unusedImports({ ...input, path: '../outside.py' }), /worktree/);
    await assert.rejects(
      workspace.call('python.organizeImports', { ...input, path: '../outside.py' }),
      /worktree/,
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await workspace.close();
  }
});

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} offers imports at the cursor from the selected worktree and unsaved buffers`, async (t) => {
    const root = await repository();
    await writeFile(join(root, 'alpha.py'), 'class ImportCandidate: pass\n');
    await writeFile(join(root, 'beta.py'), 'class ImportCandidate: pass\n');
    const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
    try {
      const project = await workspace.projects.add(root);
      const [session] = await workspace.projects.sessions(project.id);
      session.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', session);
      const input = {
        sessionId: session.id,
        path: 'main.py',
        text: 'value = ImportCandidate()\nother = Path()\n',
        version: 1,
        position: { line: 0, character: 10 },
      };
      const result = await workspace.call('python.imports', input);
      assert.deepEqual(result.value.map((action) => action.title).sort(), [
        'import alpha.ImportCandidate',
        'import beta.ImportCandidate',
      ]);
      if (kind === 'ty') {
        const server = await workspace.lsp.get(session);
        const request = server.request.bind(server);
        for (const interrupted of ['textDocument/diagnostic', 'textDocument/codeAction']) {
          let invalidated = false;
          const mock = t.mock.method(
            server,
            'request',
            async (method: string, params: unknown, signal?: AbortSignal) => {
              if (method === interrupted && !invalidated) {
                invalidated = true;
                throw Object.assign(new Error('content modified'), { code: -32801 });
              }
              return request(method, params, signal);
            },
          );
          try {
            assert.deepEqual((await workspace.call('python.imports', input)).value, result.value);
          } finally {
            mock.mock.restore();
          }
        }
      }
      for (const action of result.value) {
        assert.equal(action.edits.length, 1);
        assert.deepEqual(action.edits[0].range, {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        });
        assert.match(action.edits[0].newText, /^from (alpha|beta) import ImportCandidate\n$/);
      }
      const other = await workspace.call('session.create', {
        sessionId: session.id,
        branch: 'other-imports',
        base: 'main',
      });
      other.python = await pythonProbe(other.path, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', other);
      assert.deepEqual(
        (await workspace.call('python.imports', { ...input, sessionId: other.id })).value,
        [],
      );
      assert.deepEqual(
        (
          await workspace.call('python.imports', {
            ...input,
            text: 'from alpha import ImportCandidate\nvalue = ImportCandidate()\n',
            version: 2,
            position: { line: 1, character: 10 },
          })
        ).value,
        [],
      );
      const text = 'class FreshImportCandidate: pass\n';
      workspace.store.draft({
        sessionId: session.id,
        path: 'alpha.py',
        text,
        version: 1,
        hash: '',
      });
      await workspace.call('lsp.open', {
        sessionId: session.id,
        path: 'alpha.py',
        text,
        version: 1,
      });
      const fresh = await workspace.call('python.imports', {
        ...input,
        text: 'value = FreshImportCandidate()\n',
        version: 3,
        position: { line: 0, character: 12 },
      });
      assert.ok(fresh.value.some((action) => action.title === 'import alpha.FreshImportCandidate'));
      assert.equal((await workspace.lsp.get(session)).kind, kind);
      await assert.rejects(
        workspace.call('python.imports', { ...input, path: '../outside.py' }),
        /worktree/,
      );
    } finally {
      await workspace.close();
    }
  });

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} completes unimported names and resolves their import edits`, async () => {
    const root = await repository();
    await writeFile(join(root, 'models.py'), 'class AutoImportCandidate: pass\n');
    let analyzed!: () => void;
    const ready = new Promise<void>((resolve) => {
      analyzed = resolve;
    });
    const workspace = new Workspace(
      await temp(),
      (event) => {
        if (event.type === 'diagnostics' && event.uri.endsWith('/main.py')) analyzed();
      },
      { terminalWorker },
    );
    try {
      const project = await workspace.projects.add(root);
      const [session] = await workspace.projects.sessions(project.id);
      session.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', session);
      const text = 'value = AutoImportCand';
      const textDocument = { uri: pathToFileURL(join(session.path, 'main.py')).href };
      await workspace.call('lsp.open', {
        sessionId: session.id,
        path: 'main.py',
        text,
        version: 1,
      });
      await ready;
      const result = await workspace.call('lsp.request', {
        sessionId: session.id,
        method: 'textDocument/completion',
        params: { textDocument, position: { line: 0, character: text.length } },
      });
      const candidate = (result.value?.items ?? result.value ?? []).find(
        (item: { label: string }) => item.label === 'AutoImportCandidate',
      );
      assert.ok(
        candidate,
        `An unimported workspace class is offered while typing its prefix: ${JSON.stringify(result.value)}`,
      );
      const resolved = candidate.additionalTextEdits?.length
        ? { value: candidate }
        : await workspace.call('lsp.request', {
            sessionId: session.id,
            method: 'completionItem/resolve',
            params: { ...candidate, textDocument },
          });
      assert.ok(
        resolved.value.additionalTextEdits?.some((edit: { newText: string }) =>
          edit.newText.includes('from models import AutoImportCandidate'),
        ),
      );
      await assert.rejects(
        workspace.call('lsp.request', {
          sessionId: session.id,
          method: 'completionItem/resolve',
          params: {
            ...candidate,
            textDocument: { uri: pathToFileURL(join(session.path, '../outside.py')).href },
          },
        }),
        /worktree/,
      );
    } finally {
      await workspace.close();
    }
  });

test('Pyright completions remain available when the import index cannot start', async () => {
  const root = await repository();
  const previous = process.env.SF_TY_PATH;
  process.env.SF_TY_PATH = join(root, 'missing-ty');
  const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
  try {
    const project = await workspace.projects.add(root);
    const [session] = await workspace.projects.sessions(project.id);
    session.python = await pythonProbe(root, [3, 9]);
    workspace.store.put('sessions', session);
    await workspace.call('lsp.open', {
      sessionId: session.id,
      path: 'main.py',
      text: 'pri',
      version: 1,
    });
    const result = await workspace.call('lsp.request', {
      sessionId: session.id,
      method: 'textDocument/completion',
      params: {
        textDocument: { uri: pathToFileURL(join(session.path, 'main.py')).href },
        position: { line: 0, character: 3 },
      },
    });
    assert.ok(result.value.items.some((item: { label: string }) => item.label === 'print'));
  } finally {
    await workspace.close();
    if (previous === undefined) delete process.env.SF_TY_PATH;
    else process.env.SF_TY_PATH = previous;
  }
});

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} searches workspace symbols in unopened files and unsaved overlays`, async () => {
    const root = await repository();
    await writeFile(
      join(root, 'models.py'),
      'class Inventory:\n    def count(self): pass\n    class Inner:\n        def count(self): pass\n',
    );
    await writeFile(
      join(root, 'ambiguous.py'),
      Array.from({ length: 510 }, (_, i) => `class TestInventory${i}Control: pass`).join('\n'),
    );
    await mkdir(join(root, '.worktrees/other'), { recursive: true });
    await writeFile(
      join(root, '.worktrees/other/models.py'),
      'class InventoryFromOtherWorktree: pass\n',
    );
    const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
    try {
      const project = await workspace.projects.add(root);
      const [session] = await workspace.projects.sessions(project.id);
      session.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', session);
      const search = (query: string) =>
        workspace.call('python.symbols', { sessionId: session.id, query });
      const result = (await search('Inventory')).value;
      assert.deepEqual(
        result.hits.filter((hit) => hit.name === 'Inventory'),
        [{ path: 'models.py', line: 1, column: 1, name: 'Inventory', kind: 5 }],
      );
      assert.equal(result.hits[0]?.name, 'Inventory');
      const methods = (await search('count')).value.hits;
      assert.equal(methods.find((hit) => hit.line === 2)?.containerName, 'Inventory');
      assert.equal(methods.find((hit) => hit.line === 4)?.containerName, 'Inventory.Inner');
      assert.ok(result.hits.every((hit) => !hit.path.includes('.worktrees')));
      await workspace.call('lsp.open', {
        sessionId: session.id,
        path: 'models.py',
        text: 'class RecoveredInventory:\n    def restore(self): pass\n',
        version: 1,
      });
      workspace.store.draft({
        sessionId: session.id,
        path: 'models.py',
        text: 'class RecoveredInventory:\n    def restore(self): pass\n',
        hash: '',
        version: 1,
      });
      assert.ok(
        (await search('RecoveredInventory')).value.hits.some(
          (hit) => hit.name === 'RecoveredInventory',
        ),
      );
      assert.equal((await search('restore')).value.hits[0]?.containerName, 'RecoveredInventory');
      workspace.store.dropDraft(session.id, 'models.py', 1);
      await workspace.call('lsp.close', { sessionId: session.id, path: 'models.py' });
      assert.equal((await search('RecoveredInventory')).value.hits.length, 0);
      assert.ok((await search('Inventory')).value.hits.some((hit) => hit.name === 'Inventory'));
      assert.equal((await search('NoSuchSymbol8d71')).value.hits.length, 0);
    } finally {
      await workspace.close();
    }
  });

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} cancels interactive requests and hover enrichment without leaving queued work`, async (t) => {
    const root = await repository();
    let analyzed!: () => void;
    const ready = new Promise<void>((resolve) => {
      analyzed = resolve;
    });
    const workspace = new Workspace(
      await temp(),
      (event) => {
        if (event.type === 'diagnostics' && event.uri.endsWith('/main.py')) analyzed();
      },
      { terminalWorker },
    );
    try {
      const project = await workspace.projects.add(root);
      const [session] = await workspace.projects.sessions(project.id);
      session.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', session);
      await workspace.call('lsp.open', {
        sessionId: session.id,
        path: 'main.py',
        text: 'class Store: pass\nvalue = Store()\nvalue\n',
        version: 1,
      });
      await ready;
      const server = await workspace.lsp.get(session);
      type Message = { id?: number; method?: string; params?: { id: number } };
      const wire = server as unknown as {
        write(message: Message): void;
        pending: Map<number, unknown>;
        receive(chunk: Buffer): void;
      };
      const write = wire.write.bind(wire);
      for (const method of [
        'textDocument/hover',
        'textDocument/definition',
        'textDocument/documentSymbol',
        'textDocument/completion',
      ]) {
        let sent!: (id: number) => void;
        const requested = new Promise<number>((resolve) => {
          sent = resolve;
        });
        const cancellations: number[] = [];
        const mock = t.mock.method(wire, 'write', (message: Message) => {
          if (message.method === method) {
            sent(message.id!);
            return;
          }
          if (message.method === '$/cancelRequest') {
            cancellations.push(message.params!.id);
            return;
          }
          write(message);
        });
        const requestId = `cancel-${method}`;
        const input = {
          sessionId: session.id,
          path: 'main.py',
          position: { line: 1, character: 10 },
          requestId,
        };
        const pending =
          method === 'textDocument/completion'
            ? workspace.call('lsp.request', {
                sessionId: session.id,
                requestId,
                method,
                params: {
                  textDocument: { uri: pathToFileURL(join(session.path, 'main.py')).href },
                  position: input.position,
                },
              })
            : workspace.call('python.hover', input);
        const rejected = assert.rejects(pending, /cancel|abort/i);
        const id = await requested;
        await workspace.call('lsp.cancel', { sessionId: session.id, requestId: 'unrelated' });
        workspace.python.cancel({ ...session, id: 'another-session' }, requestId);
        assert.ok(wire.pending.has(id));
        await workspace.call('lsp.cancel', { sessionId: session.id, requestId });
        await rejected;
        assert.deepEqual(cancellations, [id]);
        assert.equal(wire.pending.size, 0);
        const late = JSON.stringify({ jsonrpc: '2.0', id, result: { stale: true } });
        wire.receive(Buffer.from(`Content-Length: ${Buffer.byteLength(late)}\r\n\r\n${late}`));
        assert.equal(wire.pending.size, 0);
        mock.mock.restore();
      }
      const hover = await workspace.call('python.hover', {
        sessionId: session.id,
        path: 'main.py',
        position: { line: 1, character: 10 },
      });
      assert.ok(hover.value?.markdown.includes('Store'));
    } finally {
      await workspace.close();
    }
  });

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} hover links resolve defining scopes, aliases, dependencies and unsaved source`, async () => {
    const root = await repository();
    await mkdir(join(root, 'pkg'));
    await writeFile(join(root, 'pkg/__init__.py'), 'from .models import helper as public\n');
    await mkdir(join(root, 'libs/backend/service'), { recursive: true });
    await mkdir(join(root, 'src/namespace'), { recursive: true });
    await writeFile(join(root, 'libs/backend/service/__init__.py'), 'def entry() -> None: pass\n');
    await writeFile(join(root, 'src/namespace/models.py'), 'def alpha() -> None: pass\n');
    await writeFile(
      join(root, 'pyrightconfig.json'),
      JSON.stringify({ extraPaths: ['libs/backend', 'src'] }),
    );
    await writeFile(
      join(root, 'ty.toml'),
      '[environment]\nextra-paths = ["libs/backend", "src"]\n',
    );
    const models = [
      'class Base:',
      '    def inherited(self) -> int: return 1',
      'class Store(Base):',
      '    """Store documentation."""',
      '    def __init__(self, get_response: object | None = None): pass',
      '    @classmethod',
      '    def create(cls) -> "Store": return cls()',
      '    @staticmethod',
      '    def count() -> int: return 42',
      '    @property',
      '    def size(self) -> int: return 42',
      '    class Nested:',
      '        def run(self) -> None: pass',
      'def helper() -> str: return "ok"',
      'class UnknownGetter:',
      '    def __init__(self):',
      '        self.attribute_path = self.get_attribute_path()',
      '',
    ].join('\n');
    await writeFile(join(root, 'pkg/models.py'), models);
    const lines = [
      'from pkg.models import Store as Alias, helper as renamed',
      'import base64',
      'value = Alias()',
      'value.inherited()',
      'Alias.create()',
      'Alias.count()',
      'value.size',
      'Alias.Nested().run()',
      'renamed()',
      'base64.decodebytes(b"")',
      'import pkg.models as module',
      'module',
      'from pkg import public',
      'public()',
      'from service import entry',
      'entry()',
      'from namespace.models import alpha',
      'alpha()',
    ];
    await writeFile(join(root, 'main.py'), lines.join('\n'));
    const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
    const callPython = async <M extends 'lsp.request' | 'python.hover' | 'python.source'>(
      method: M,
      input: Input<M>,
    ): Promise<Results[M]['value']> => (await workspace.call(method, input)).value;
    try {
      const project = await workspace.projects.add(root);
      const [session] = await workspace.projects.sessions(project.id);
      session.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', session);
      await workspace.call('lsp.open', {
        sessionId: session.id,
        path: 'main.py',
        text: lines.join('\n'),
        version: 1,
      });
      for (const [line, word, owner] of [
        [2, 'Alias', []],
        [3, 'inherited', ['Base']],
        [4, 'create', ['Store']],
        [5, 'count', ['Store']],
        [6, 'size', ['Store']],
        [7, 'run', ['Store', 'Nested']],
        [8, 'renamed', []],
        [13, 'public', []],
      ] as const) {
        const input = {
          sessionId: session.id,
          path: 'main.py',
          position: { line, character: lines[line].indexOf(word) + 1 },
        };
        const hover = await callPython('python.hover', input);
        assert.ok(hover, word);
        assert.ok(hover.markdown.includes('```python'), word);
        if (word === 'Alias') {
          const raw = await callPython('lsp.request', {
            sessionId: session.id,
            method: 'textDocument/hover',
            params: {
              textDocument: { uri: pathToFileURL(join(session.path, 'main.py')).href },
              position: input.position,
            },
          });
          assert.equal(hover.markdown, raw.contents.value);
          assert.match(hover.markdown, /Store documentation/);
        }
        const definition = hover.definitions[0];
        assert.equal(definition.module.name, 'pkg.models', word);
        assert.deepEqual(
          definition.containers.map((scope) => scope.name),
          owner,
          word,
        );
        const source = await callPython('python.source', { ...input, target: definition.symbol });
        assert.equal(source.text, models);
        assert.equal(source.workspacePath, 'pkg/models.py');
        for (const target of [definition.module, ...definition.containers])
          assert.equal((await callPython('python.source', { ...input, target })).text, models);
      }
      for (const [line, name] of [
        [11, 'pkg.models'],
        [15, 'service'],
        [17, 'namespace.models'],
      ] as const) {
        const hover = await callPython('python.hover', {
          sessionId: session.id,
          path: 'main.py',
          position: { line, character: 1 },
        });
        assert.equal(hover?.definitions[0].module.name, name);
        if (line === 11) assert.equal(hover.definitions[0].symbol.kind, 2);
      }
      for (const [line, word, binding] of [
        [4, 'get_response', true],
        [8, 'count', false],
      ] as const) {
        const hover = await callPython('python.hover', {
          sessionId: session.id,
          path: 'pkg/models.py',
          position: { line, character: models.split('\n')[line].indexOf(word) + 1 },
        });
        assert.equal(Boolean(hover?.definitions[0]?.binding), binding && kind === 'ty', word);
      }
      const field = await callPython('python.hover', {
        sessionId: session.id,
        path: 'pkg/models.py',
        position: { line: 16, character: 15 },
      });
      assert.ok(
        field?.definitions.some(
          ({ symbol }) =>
            symbol.range?.start.line === 16 &&
            symbol.range.start.character <= 13 &&
            symbol.range.end.line === 16 &&
            symbol.range.end.character === 27,
        ),
      );
      const input = {
        sessionId: session.id,
        path: 'main.py',
        position: { line: 9, character: 10 },
      };
      const hover = await callPython('python.hover', input);
      assert.equal(hover?.definitions[0]?.module.name, 'base64');
      const external = await callPython('python.source', {
        ...input,
        target: hover!.definitions[0].symbol,
      });
      assert.match(external.text, /def decodebytes/);
      assert.equal(external.workspacePath, undefined);
      assert.ok(external.symbols?.some((symbol) => symbol.name === 'decodebytes'));
      await assert.rejects(
        callPython('python.source', {
          ...input,
          target: { uri: pathToFileURL('/etc/passwd').href, position: { line: 0, character: 0 } },
        }),
        /definition/,
      );
      await assert.rejects(
        callPython('python.hover', { ...input, path: '../outside.py' }),
        /worktree/,
      );
      const draft = models.replace('return 42', 'return 99');
      workspace.store.draft({
        sessionId: session.id,
        path: 'pkg/models.py',
        text: draft,
        version: 2,
        hash: 'disk',
      });
      await workspace.call('lsp.open', {
        sessionId: session.id,
        path: 'pkg/models.py',
        text: draft,
        version: 2,
      });
      const local = { ...input, position: { line: 5, character: 8 } };
      const updated = await callPython('python.hover', local);
      assert.equal(
        (await callPython('python.source', { ...local, target: updated!.definitions[0].symbol }))
          .text,
        draft,
      );
    } finally {
      await workspace.close();
    }
  });
