import { parsePatchFiles } from '@pierre/diffs';
self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ files: parsePatchFiles(event.data).flatMap((p) => p.files) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Could not parse this diff.',
    });
  }
};
