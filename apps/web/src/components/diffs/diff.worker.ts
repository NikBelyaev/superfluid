import { parseDiffFromFile, parsePatchFiles, type FileContents } from '@pierre/diffs';
import { fileDiffOptions } from './diffOptions';
import { inlineRanges } from './inlineRanges';

self.onmessage = (
  event: MessageEvent<
    | string
    | { id: number; oldFile: FileContents; newFile: FileContents }
    | { inline: { original: string; modified: string } }
  >,
) => {
  const input = event.data;
  const id = typeof input === 'string' || 'inline' in input ? undefined : input.id;
  try {
    if (typeof input !== 'string' && 'inline' in input) {
      self.postMessage({ ranges: inlineRanges(input.inline.original, input.inline.modified) });
      return;
    }
    self.postMessage({
      id,
      files:
        typeof input === 'string'
          ? parsePatchFiles(input).flatMap((p) => p.files)
          : [parseDiffFromFile(input.oldFile, input.newFile, fileDiffOptions)],
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Could not parse this diff.',
    });
  }
};
