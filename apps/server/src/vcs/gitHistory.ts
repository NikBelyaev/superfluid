import type { GitHistoryCommit, ParsedInput, Results } from '@superfluid/contracts';
import { digest } from '../utils/digest';
import { git } from './gitCommand';

const pageSize = 100;
const namespaces = { heads: 'branch', remotes: 'remote', tags: 'tag' } as const;

export async function gitHistory(
  path: string,
  { cursor, query }: Pick<ParsedInput<'git.history'>, 'cursor' | 'query'> = {},
): Promise<Results['git.history']> {
  const [head, refs] = await Promise.all([
    git(path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { accept: [1] }),
    git(path, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(refname)%00%(symref)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]),
  ]);
  const labels = new Map<string, GitHistoryCommit['refs']>();
  const headHash = head.trim();
  if (headHash) labels.set(headHash, [{ name: 'HEAD', kind: 'head' }]);
  for (const line of refs.split('\n')) {
    const [object, type, peeled, peeledType, ref, symbolic] = line.split('\0');
    const hash = type === 'commit' ? object : peeledType === 'commit' ? peeled : undefined;
    if (!hash || symbolic) continue;
    const end = ref.indexOf('/', 'refs/'.length);
    const kind = namespaces[ref.slice('refs/'.length, end) as keyof typeof namespaces];
    const label = { name: ref.slice(end + 1), kind };
    const existing = labels.get(hash);
    if (existing) existing.push(label);
    else labels.set(hash, [label]);
  }

  const revision = digest(`${head}${refs}\0${query ?? ''}`);
  if (cursor && cursor.revision !== revision)
    throw new Error('Git history changed. Refresh to load older commits.');
  if (!labels.size) return { commits: [], next: null };

  const offset = cursor?.offset ?? 0;
  const log = await git(
    path,
    [
      'log',
      '--stdin',
      '--topo-order',
      '--no-decorate',
      '--no-color',
      '--no-notes',
      '--no-show-signature',
      '--no-patch',
      '--encoding=UTF-8',
      ...(query ? ['--fixed-strings', '--regexp-ignore-case', `--grep=${query}`] : []),
      '-z',
      `--skip=${offset}`,
      `--max-count=${pageSize + 1}`,
      '--format=%H%x00%P%x00%an%x00%aI%x00%s',
      '--',
    ],
    { input: [...labels.keys()].join('\n') + '\n' },
  );
  const fields = log.split('\0');
  const commits: GitHistoryCommit[] = [];
  for (let i = 0; i + 4 < fields.length && commits.length < pageSize; i += 5) {
    const [hash, parents, author, date, subject] = fields.slice(i, i + 5);
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      author,
      date,
      subject,
      refs: labels.get(hash) ?? [],
    });
  }
  return {
    commits,
    next: fields.length > pageSize * 5 + 1 ? { offset: offset + pageSize, revision } : null,
  };
}

function readCommitDiff(path: string, hash: string, format: string[]) {
  return git(
    path,
    [
      'show',
      '--root',
      '--format=',
      '--diff-merges=first-parent',
      ...format,
      '--find-renames',
      '--no-notes',
      '--no-show-signature',
      '--no-color',
      '--no-textconv',
      '--no-ext-diff',
      hash,
      '--',
    ],
    { timeout: 5000 },
  );
}

export function gitHistoryPatch(path: string, hash: string) {
  return readCommitDiff(path, hash, ['--patch']);
}

export async function gitHistoryStats(
  path: string,
  hash: string,
): Promise<Results['git.historyStats']> {
  const numstat = await readCommitDiff(path, hash, ['--numstat', '-z']);
  const records = numstat.split('\0');
  const stats = { insertions: 0, deletions: 0, files: 0 };
  for (let index = 0; index < records.length - 1; index++) {
    const record = records[index];
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(record);
    if (!match) continue;
    stats.files++;
    stats.insertions += Number(match[1]) || 0;
    stats.deletions += Number(match[2]) || 0;
    // Renames encode the old and new path as separate NUL-terminated fields.
    if (record.length === match[0].length) index += 2;
  }
  return stats;
}
