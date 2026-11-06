import { realpath } from 'node:fs/promises';
import { relative, resolve, dirname, isAbsolute } from 'node:path';

export function logicalPath(root: string, path: string) {
  if (isAbsolute(path) || path.includes('\0')) throw new Error('Use a path inside this worktree.');
  const file = resolve(root, path),
    rel = relative(resolve(root), file);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('This path is outside the worktree.');
  return file;
}

export async function within(root: string, path: string, create = false): Promise<string> {
  const base = await realpath(root),
    lexical = logicalPath(base, path);
  const check = (candidate: string) => {
    const rel = relative(base, candidate);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      throw new Error('This path is outside the worktree.');
  };
  check(lexical);
  let actual = lexical;
  if (create) {
    let ancestor = lexical;
    for (;;) {
      try {
        const canonical = await realpath(ancestor);
        actual = resolve(canonical, relative(ancestor, lexical));
        break;
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
  } else actual = await realpath(lexical);
  check(actual);
  return actual;
}
