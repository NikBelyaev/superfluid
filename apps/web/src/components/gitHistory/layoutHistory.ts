import type { GitHistoryCommit } from '@superfluid/contracts';

export const historyRowHeight = 36;
const spacing = 14;
const center = historyRowHeight / 2;
export const laneX = (lane: number) => 7 + lane * spacing;

export function layoutHistory(commits: Pick<GitHistoryCommit, 'hash' | 'parents'>[]) {
  const pending = new Map<string, { lane: number; branch: number }>();
  const lanes: (string | undefined)[] = [];
  let width = 0;
  let nextBranch = 0;
  const freeLane = () => {
    const free = lanes.indexOf(undefined);
    return free < 0 ? lanes.length : free;
  };
  const newBranch = () => ({ lane: freeLane(), branch: nextBranch++ });

  const rows = commits.map((commit) => {
    const incoming = pending.get(commit.hash);
    const current = incoming ?? newBranch();
    const { lane } = current;
    const x = laneX(lane);
    pending.delete(commit.hash);
    lanes[lane] = undefined;
    const lines = [...pending.values()].map((through) => ({
      ...through,
      path: `M${laneX(through.lane)} 0V${historyRowHeight}`,
    }));
    if (incoming !== undefined) lines.push({ ...incoming, path: `M${x} 0V${center}` });

    for (const [index, parent] of commit.parents.entries()) {
      const target = pending.get(parent) ?? (index === 0 ? current : newBranch());
      pending.set(parent, target);
      lanes[target.lane] = parent;
      const to = laneX(target.lane);
      lines.push({
        ...target,
        path:
          x === to
            ? `M${x} ${center}V${historyRowHeight}`
            : `M${x} ${center}C${x} ${center + 10} ${to} ${historyRowHeight - 10} ${to} ${historyRowHeight}`,
      });
    }
    const nodeEdge = x + (commit.parents.length > 1 ? 6 : 4.5);
    const rowWidth = Math.max(nodeEdge, laneX(lanes.length - 1) + 1);
    width = Math.max(width, rowWidth);
    while (lanes.length && lanes.at(-1) === undefined) lanes.pop();
    return { ...current, lines, width: rowWidth };
  });

  return { rows, width };
}
