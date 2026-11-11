import type { FileDiffMetadata } from '@pierre/diffs';
import { lineMarkers } from './lineMarkers';

export function inlineHunk(file: FileDiffMetadata, line: number) {
  const markers = lineMarkers(file);
  let index = 0;
  for (const hunk of file.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type !== 'change') continue;
      const marker = markers[index++];
      if (line < marker.start || line > marker.end) continue;
      return {
        ...marker,
        original: file.deletionLines
          .slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions)
          .join(''),
        modified: file.additionLines
          .slice(content.additionLineIndex, content.additionLineIndex + content.additions)
          .join(''),
        originalLine: content.deletionLineIndex + 1,
        modifiedLine: content.additionLineIndex + 1,
      };
    }
  }
}

export function rollbackEdit(
  file: FileDiffMetadata,
  change: NonNullable<ReturnType<typeof inlineHunk>>,
) {
  const start = file.additionLines.slice(0, change.modifiedLine - 1).join('').length;
  return { start, end: start + change.modified.length, text: change.original };
}
