import * as monaco from 'monaco-editor/editor/editor.api';

// Register contributions before language registration initializes Monaco services.
import 'monaco-editor/editor/browser/coreCommands';

import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';

import 'monaco-editor/editor/contrib/find/browser/findController';

import 'monaco-editor/editor/contrib/suggest/browser/suggestController';

import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';

import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands';

import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols';

import 'monaco-editor/editor/contrib/snippet/browser/snippetController2';

import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';

import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';

import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';

import 'monaco-editor/editor/contrib/comment/browser/comment';

import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';

import 'monaco-editor/editor/contrib/folding/browser/folding';

import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';

import 'monaco-editor/languages/definitions/python/register';

import 'monaco-editor/languages/definitions/yaml/register';

import 'monaco-editor/languages/definitions/markdown/register';

import 'monaco-editor/languages/definitions/shell/register';

import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
(self as typeof self & { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
export { monaco };
