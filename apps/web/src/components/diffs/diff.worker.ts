import { parseDiffFromFile, parsePatchFiles, type FileContents } from '@pierre/diffs';
import { fileDiffOptions } from './diffOptions';

self.onmessage = (
  event: MessageEvent<string | { id: number; oldFile: FileContents; newFile: FileContents }>,
) => {
  const input = event.data;
  const id = typeof input === 'string' ? undefined : input.id;
  try {
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
