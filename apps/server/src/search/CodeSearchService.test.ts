import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Workspace } from '../workspace/Workspace';
import { repository, temp, terminalWorker, pythonProbe } from '../../../../tests/fixtures';
import type { SearchType } from '@superfluid/contracts';

test('combined search filters types and repository ownership before result limits, and previews drafts', async (t) => {
  const root = await repository();
  await writeFile(
    join(root, 'needle.py'),
    'class NeedleRoot: pass\ndef needle_function(): pass\n' + 'needle\n'.repeat(510),
  );
  await writeFile(join(root, 'nested-needle-neighbor.py'), 'needle neighbor\n');
  const documentExtensions = ['md', 'MDX', 'rst', 'txt', 'adoc', 'asciidoc', 'org'];
  for (const extension of documentExtensions)
    await writeFile(join(root, `needle.${extension}`), 'needle documentation\n');
  await rename(await repository(), join(root, 'nested'));
  await writeFile(join(root, 'nested/needle.py'), 'class NeedleNested: pass\nneedle\n');
  await writeFile(join(root, 'nested/needle.md'), 'nested documentation\n');
  await writeFile(
    join(root, 'README.md'),
    'Introduction\n' + '😀'.repeat(600) + 'needle reference\n',
  );
  await writeFile(
    join(root, 'ranking.py'),
    'class TestLoadTypeCategoryControl: pass\nclass LoadTypeWithRootCategoryEntity: pass\nclass LoadTypeCategoryControl: pass\nclass LoadTypeCategory: pass\n',
  );
  const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
  try {
    const project = await workspace.projects.add(root);
    const [session] = await workspace.projects.sessions(project.id);
    session.python = await pythonProbe(root, [3, 10]);
    workspace.store.put('sessions', session);
    const repos = await workspace.call('git.repositories', { sessionId: session.id });
    const nested = repos.find((r) => r.path === 'nested')!;
    const main = repos.find((r) => !r.path)!;
    const search = (types: SearchType[] = [], repositoryIds?: string[]) =>
      workspace.call('search.query', {
        sessionId: session.id,
        query: 'needle',
        types,
        repositoryIds,
        requestId: crypto.randomUUID(),
      });
    const all = await search();
    assert.deepEqual(
      new Set(all.hits.map((hit) => hit.type)),
      new Set(['class', 'file', 'document', 'symbol', 'text']),
    );
    assert.equal(all.truncated, true);
    const documents = await search(['document']);
    assert.equal(documents.hits.length, documentExtensions.length + 2);
    assert.ok(documents.hits.every((hit) => hit.type === 'document'));
    const content = documents.hits.find((hit) => hit.path === 'README.md');
    assert.equal(content?.line, 2);
    assert.equal(content?.column, 1201);
    assert.ok(content?.text?.includes('needle reference'));
    assert.equal(documents.hits.filter((hit) => hit.path === 'needle.md').length, 1);
    assert.equal(documents.truncated, false);
    const ordered = await workspace.call('search.query', {
      sessionId: session.id,
      query: 'LoadTypeCategory',
      types: ['class'],
      requestId: crypto.randomUUID(),
    });
    assert.deepEqual(
      ordered.hits.slice(0, 3).map((hit) => hit.name),
      ['LoadTypeCategory', 'LoadTypeCategoryControl', 'TestLoadTypeCategoryControl'],
    );
    workspace.store.draft({
      sessionId: session.id,
      path: 'README.md',
      text: '😀'.repeat(600) + 'unsaved needle details\n',
      hash: '',
      version: 1,
    });
    assert.ok(
      (await search(['document'])).hits
        .find((hit) => hit.path === 'README.md')
        ?.text?.includes('unsaved needle details'),
    );
    const nestedDocuments = await search(['document'], [nested.id]);
    assert.deepEqual(
      nestedDocuments.hits.map((hit) => hit.path),
      ['nested/needle.md'],
    );
    const everyType = await search(['class', 'file', 'document', 'symbol', 'text']);
    assert.deepEqual(
      new Set(everyType.hits.map((hit) => hit.type)),
      new Set(all.hits.map((hit) => hit.type)),
    );
    const classes = await search(['class']);
    assert.ok(classes.hits.length >= 2);
    assert.ok(classes.hits.every((hit) => hit.kind === 5 && hit.type === 'class'));
    const symbols = await search(['symbol']);
    assert.ok(symbols.hits.some((hit) => hit.name === 'needle_function'));
    assert.ok(symbols.hits.every((hit) => hit.kind !== 5));
    const scoped = await search(['text', 'file'], [nested.id]);
    assert.deepEqual(
      scoped.hits.map((hit) => hit.type),
      ['file', 'text'],
    );
    assert.ok(
      scoped.hits.every((hit) => hit.path === 'nested/needle.py' && hit.repositoryId === nested.id),
    );
    assert.equal(scoped.truncated, false);
    const rootOnly = await search(['file'], [main.id]);
    assert.ok(rootOnly.hits.some((hit) => hit.path === 'nested-needle-neighbor.py'));
    assert.ok(rootOnly.hits.every((hit) => !hit.path.startsWith('nested/')));
    assert.ok(rootOnly.hits.every((hit) => hit.path.endsWith('.py')));
    assert.equal((await search([], [])).hits.length, 0);
    await assert.rejects(search([], ['foreign-repository']), /unavailable/);
    workspace.store.draft({
      sessionId: session.id,
      path: 'nested/needle.py',
      text: 'draft needle\n',
      hash: '',
      version: 1,
    });
    const preview = await workspace.call('search.preview', {
      sessionId: session.id,
      path: 'nested/needle.py',
      line: 1,
    });
    assert.equal(preview.text, 'draft needle\n');
    await assert.rejects(
      workspace.call('search.preview', { sessionId: session.id, path: '../outside.py' }),
      /outside|worktree/,
    );
    let release!: () => void;
    const discovery = new Promise<typeof repos>((resolve) => {
      release = () => resolve(repos);
    });
    t.mock.method(workspace.sourceControl.repositories, 'list', () => discovery);
    const pending = workspace.call('search.query', {
      sessionId: session.id,
      query: 'needle',
      types: ['text'],
      requestId: 'cancel-discovery',
    });
    const rejected = assert.rejects(pending, /cancel/i);
    await workspace.call('search.cancel', { sessionId: session.id, requestId: 'cancel-discovery' });
    release();
    await rejected;
  } finally {
    await workspace.close();
  }
});
