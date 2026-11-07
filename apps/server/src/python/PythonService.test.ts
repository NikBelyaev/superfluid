import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workspace } from '../workspace/Workspace';
import { repository, temp, terminalWorker } from '../../../../tests/fixtures';

test('Python hover links resolve defining scopes, aliases, dependencies and unsaved source', async () => {
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
  try {
    const project = await workspace.projects.add(root);
    const [session] = await workspace.projects.sessions(project.id);
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
      const hover = await workspace.call('python.hover', input);
      assert.ok(hover, word);
      assert.ok(hover.markdown.includes('```python'), word);
      if (word === 'Alias') {
        const raw = await workspace.call('lsp.request', {
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
      const source = await workspace.call('python.source', { ...input, target: definition.symbol });
      assert.equal(source.text, models);
      assert.equal(source.workspacePath, 'pkg/models.py');
      for (const target of [definition.module, ...definition.containers])
        assert.equal((await workspace.call('python.source', { ...input, target })).text, models);
    }
    for (const [line, name] of [
      [11, 'pkg.models'],
      [15, 'service'],
      [17, 'namespace.models'],
    ] as const) {
      const hover = await workspace.call('python.hover', {
        sessionId: session.id,
        path: 'main.py',
        position: { line, character: 1 },
      });
      assert.equal(hover?.definitions[0].module.name, name);
      if (line === 11) assert.equal(hover.definitions[0].symbol.kind, 2);
    }
    const input = { sessionId: session.id, path: 'main.py', position: { line: 9, character: 10 } };
    const hover = await workspace.call('python.hover', input);
    assert.equal(hover?.definitions[0]?.module.name, 'base64');
    const external = await workspace.call('python.source', {
      ...input,
      target: hover!.definitions[0].symbol,
    });
    assert.match(external.text, /def decodebytes/);
    assert.equal(external.workspacePath, undefined);
    await assert.rejects(
      workspace.call('python.source', {
        ...input,
        target: { uri: pathToFileURL('/etc/passwd').href, position: { line: 0, character: 0 } },
      }),
      /definition/,
    );
    await assert.rejects(
      workspace.call('python.hover', { ...input, path: '../outside.py' }),
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
    const updated = await workspace.call('python.hover', local);
    assert.equal(
      (await workspace.call('python.source', { ...local, target: updated!.definitions[0].symbol }))
        .text,
      draft,
    );
  } finally {
    await workspace.close();
  }
});
