/// <reference types="vite/client" />

declare module 'monaco-editor/languages/definitions/python/python' {
  export const conf: import('monaco-editor/editor/editor.api').languages.LanguageConfiguration;
  export const language: import('monaco-editor/editor/editor.api').languages.IMonarchLanguage;
}

declare module 'monaco-editor/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer' {
  export class DefaultLinesDiffComputer {
    computeDiff(
      original: string[],
      modified: string[],
      options: {
        ignoreTrimWhitespace: boolean;
        maxComputationTimeMs: number;
        computeMoves: boolean;
      },
    ): {
      changes: {
        innerChanges?: {
          originalRange: import('monaco-editor/editor/editor.api').IRange;
          modifiedRange: import('monaco-editor/editor/editor.api').IRange;
        }[];
      }[];
    };
  }
}
