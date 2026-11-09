import type { GitFile } from '@superfluid/contracts';

export function treeGit(files: readonly GitFile[] = []) {
  const statuses = new Map<string, string>();
  const directories = new Set<string>();
  for (const file of files) {
    const code = file.index === '?' ? '?' : file.worktree !== '.' ? file.worktree : file.index;
    const conflict =
      file.index === 'U' ||
      file.worktree === 'U' ||
      ['AA', 'DD'].includes(file.index + file.worktree);
    const status = conflict
      ? 'conflict'
      : code === '?'
        ? 'untracked'
        : code === 'A' || code === 'C'
          ? 'added'
          : code === 'D'
            ? 'deleted'
            : code === 'R'
              ? 'renamed'
              : code === '!'
                ? 'ignored'
                : 'modified';
    statuses.set(file.path, status);
    if (status === 'ignored') continue;
    for (
      let end = file.path.lastIndexOf('/');
      end >= 0;
      end = file.path.lastIndexOf('/', end - 1)
    ) {
      directories.add(file.path.slice(0, end));
      if (end === 0) break;
    }
    directories.add('');
    if (file.original) {
      const original = file.original.split('/');
      original.pop();
      while (original.length) {
        directories.add(original.join('/'));
        original.pop();
      }
    }
  }
  return {
    statuses,
    directories,
    getStatus(path: string) {
      const direct = statuses.get(path) ?? statuses.get(path + '/');
      if (direct) return direct;
      for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
        const inherited = statuses.get(path.slice(0, end + 1));
        if (inherited === 'untracked' || inherited === 'ignored') return inherited;
      }
    },
  };
}
