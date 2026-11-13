import { DefaultLinesDiffComputer } from 'monaco-editor/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer';

export function inlineRanges(original: string, modified: string) {
  const result = new DefaultLinesDiffComputer().computeDiff(
    original.split(/\r\n|\r|\n/),
    modified.split(/\r\n|\r|\n/),
    { ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false },
  );
  return result.changes
    .flatMap((change) => change.innerChanges ?? [])
    .map((change) => ({
      original: change.originalRange,
      modified: change.modifiedRange,
    }));
}
