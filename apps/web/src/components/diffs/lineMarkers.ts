import type { FileDiffMetadata } from '@pierre/diffs';

export function lineMarkers(file: FileDiffMetadata) {
  const markers: {
    start: number;
    end: number;
    kind: 'added' | 'modified' | 'deleted';
    before?: boolean;
  }[] = [];
  for (const hunk of file.hunks) {
    let line = hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0);
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') line += content.lines;
      else {
        markers.push(
          content.additions
            ? {
                start: line,
                end: line + content.additions - 1,
                kind: content.deletions ? 'modified' : 'added',
              }
            : {
                start: Math.max(1, line - 1),
                end: Math.max(1, line - 1),
                kind: 'deleted',
                before: line === 1,
              },
        );
        line += content.additions;
      }
    }
  }
  return markers;
}
