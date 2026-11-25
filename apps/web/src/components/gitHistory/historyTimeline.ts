import type { GitHistoryCommit, GitRepository, Results } from '@superfluid/contracts';

export type HistoryPage = Results['git.history'];
export type HistoryCursor = NonNullable<HistoryPage['next']>;
export type HistoryStream = HistoryPage & { repository: GitRepository; error?: string };
export type HistoryEntry = { repository: GitRepository; commit: GitHistoryCommit; key: string };

export const historyKey = (repository: GitRepository, hash: string) => `${repository.id}:${hash}`;

export function historyTimeline(streams: HistoryStream[]) {
  const positions = streams.map(() => 0);
  const timestamps = streams.map((stream) => Date.parse(stream.commits[0]?.date ?? '') || 0);
  const entries: HistoryEntry[] = [];
  for (;;) {
    let chosen = -1;
    let latest = -Infinity;
    for (const [index, stream] of streams.entries()) {
      const commit = stream.commits[positions[index]];
      if (!commit) {
        // Fetch this stream before comparing the next row against its unseen commits.
        if (stream.next) return { entries, next: stream };
        continue;
      }
      const date = timestamps[index];
      if (date > latest) {
        latest = date;
        chosen = index;
      }
    }
    if (chosen < 0) return { entries, next: undefined };
    const { repository, commits } = streams[chosen];
    const commit = commits[positions[chosen]++];
    timestamps[chosen] = Date.parse(commits[positions[chosen]]?.date ?? '') || 0;
    entries.push({ repository, commit, key: historyKey(repository, commit.hash) });
  }
}
