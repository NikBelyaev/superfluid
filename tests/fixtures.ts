import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../apps/server/src/vcs/gitCommand';
import type { Session } from '@superfluid/contracts';

export const temp = () => mkdtemp(join(tmpdir(), 'superfluid-test-'));

export const session = (path: string): Session => ({
  id: 'test',
  projectId: 'project',
  path,
  branch: 'main',
  head: '',
  gitDir: join(path, '.git'),
  python: 'python3',
  state: {},
  available: true,
});

export async function repository() {
  const root = await temp();
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Superfluid Test']);
  await git(root, ['config', 'user.email', 'test@superfluid.invalid']);
  await writeFile(join(root, 'main.py'), 'print("initial")\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'Initial']);
  return root;
}

export const terminalWorker = new URL('../dist/terminal-worker.mjs', import.meta.url);
