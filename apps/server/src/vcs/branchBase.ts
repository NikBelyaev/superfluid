import { git, safeRef } from './gitCommand';

export async function resolveBranch(path: string, ref: string) {
  const resolved = (
    await git(path, ['rev-parse', '--symbolic-full-name', safeRef(ref)], { accept: [128] })
  ).trim();
  if (resolved.startsWith('refs/heads/')) return resolved.slice('refs/heads/'.length);
  const remotes = (await git(path, ['remote']))
    .trim()
    .split('\n')
    .sort((a, b) => b.length - a.length);
  const remote = remotes.find((remote) => resolved.startsWith(`refs/remotes/${remote}/`));
  return remote ? resolved.slice(`refs/remotes/${remote}/`.length) : undefined;
}

export async function readBranchBase(path: string, branch: string) {
  const configured = (
    await git(path, ['config', '--get', `branch.${safeRef(branch)}.gh-merge-base`], { accept: [1] })
  ).trim();
  if (configured) return safeRef(configured);
  const creation = (
    await git(
      path,
      [
        'reflog',
        'show',
        '--format=%gs',
        '--grep-reflog=^branch: Created from ',
        '-1',
        `refs/heads/${branch}`,
      ],
      { accept: [128] },
    )
  ).trim();
  const source = creation.replace(/^branch: Created from /, '');
  return source && source !== 'HEAD' ? resolveBranch(path, source) : undefined;
}
