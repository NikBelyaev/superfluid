import { callPython } from '~/rpc/python';
import type { PythonLocation } from '@superfluid/contracts';
import { documents, monaco } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import { openDefinition } from './definitionPreview';
import { onPythonReset, pythonGeneration } from '~/state/python';

type Definition =
  | { uri: string; range: { start: PythonLocation['position'] } }
  | { targetUri: string; targetSelectionRange: { start: PythonLocation['position'] } };
type DefinitionTarget = PythonLocation & { generation: number };

type ContentHover = monaco.editor.IEditorContribution & {
  readonly isHoverVisible: boolean;
  hideContentHover(): void;
  showContentHover(range: monaco.Range, mode: 1, source: 0, focus: false): void;
};

export function installDefinitionLinks(
  editor: monaco.editor.IStandaloneCodeEditor,
  root: HTMLElement,
) {
  // Native definition links require a file model resolver; workspace files use our bridge.
  editor.getContribution('editor.contrib.gotodefinitionatposition')?.dispose();
  const decorations = editor.createDecorationsCollection();
  let point: monaco.IPosition | null = null;
  let mouseRange: monaco.Range | null = null;
  let modified = false;
  let key = '';
  let hoverKey = '';
  let pressed = '';
  let serial = 0;
  let controller: AbortController | undefined;
  let pending: Promise<DefinitionTarget | undefined> = Promise.resolve(undefined);
  const clear = () => {
    controller?.abort();
    controller = undefined;
    hoverKey = '';
    if (!key) return;
    key = '';
    serial++;
    decorations.clear();
  };
  const reset = () => {
    point = null;
    mouseRange = null;
    pressed = '';
    pending = Promise.resolve(undefined);
    clear();
  };
  const refresh = () => {
    const model = editor.getModel();
    if (!modified || !point || !mouseRange || !model || model.getLanguageId() !== 'python') {
      clear();
      return;
    }
    const word = model.getWordAtPosition(point);
    if (!word) {
      clear();
      return;
    }
    const next = `${model.id}:${model.getVersionId()}:${point.lineNumber}:${word.startColumn}`;
    if (next !== key) clear();
    const anchor = `${next}:${mouseRange.startColumn}:${mouseRange.endColumn}`;
    if (anchor !== hoverKey) {
      hoverKey = anchor;
      // Monaco's public hover action uses the caret; this contribution accepts the mouse range.
      const hover = editor.getContribution<ContentHover>('editor.contrib.contentHover');
      if (next !== key || !hover?.isHoverVisible) {
        hover?.hideContentHover();
        hover?.showContentHover(mouseRange, 1 /* Immediate */, 0 /* Mouse */, false);
      }
    }
    if (next === key) return;
    const doc = documents.find(model);
    if (!doc || doc.readOnly) return;
    key = next;
    const request = ++serial;
    const version = doc.version;
    const position = { line: point.lineNumber - 1, character: point.column - 1 };
    const signal = (controller = new AbortController()).signal;
    const range = new monaco.Range(
      point.lineNumber,
      word.startColumn,
      point.lineNumber,
      word.endColumn,
    );
    pending = (async () => {
      await documents.sync(doc);
      const result: Definition[] | Definition | null = await callPython(
        'lsp.request',
        {
          sessionId: doc.session.id,
          method: 'textDocument/definition',
          params: { textDocument: { uri: documents.diskUri(doc) }, position },
        },
        signal,
      );
      const first = Array.isArray(result) ? result[0] : result;
      if (!first) return;
      const target =
        'uri' in first
          ? { uri: first.uri, position: first.range.start }
          : { uri: first.targetUri, position: first.targetSelectionRange.start };
      if (request === serial && doc.version === version && editor.getModel() === model)
        decorations.set([
          {
            range,
            options: {
              inlineClassName: 'symbol-definition-link',
            },
          },
        ]);
      return { ...target, generation: pythonGeneration(doc.session.id) };
    })().catch(() => undefined);
  };
  const keys = (event: KeyboardEvent) => {
    modified = event.metaKey || event.ctrlKey;
    if (event.key === 'Meta' || event.key === 'Control') refresh();
    else clear();
  };
  const blur = () => {
    modified = false;
    reset();
  };
  const subscriptions = [
    editor.onMouseMove((event) => {
      if (event.event.browserEvent.buttons) {
        reset();
        return;
      }
      modified = event.event.metaKey || event.event.ctrlKey;
      point =
        event.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT
          ? event.target.position
          : null;
      mouseRange = event.target.range && monaco.Range.lift(event.target.range);
      refresh();
    }),
    editor.onMouseDown((event) => {
      modified = event.event.metaKey || event.event.ctrlKey;
      point =
        event.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT
          ? event.target.position
          : null;
      mouseRange = event.target.range && monaco.Range.lift(event.target.range);
      refresh();
      pressed = modified && event.event.leftButton && event.event.detail === 1 ? key : '';
    }),
    editor.onMouseLeave(reset),
    editor.onDidChangeModel(reset),
    editor.onDidChangeModelContent(reset),
    editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged || event.scrollLeftChanged) reset();
    }),
  ];
  const click = (event: MouseEvent) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.button !== 0 ||
      !pressed ||
      pressed !== key ||
      !point
    )
      return;
    const model = editor.getModel();
    const doc = model && documents.find(model);
    if (!doc) return;
    const version = doc.version;
    const position = { line: point.lineNumber - 1, character: point.column - 1 };
    event.preventDefault();
    event.stopImmediatePropagation();
    pressed = '';
    // A committed click must outlive hover cancellation on keyup or mouseleave.
    controller = undefined;
    void pending
      .then(
        (target) =>
          target &&
          openDefinition(doc.model.uri.toString(), version, position, target, target.generation),
      )
      .catch(useApp.getState().fail);
  };
  root.addEventListener('click', click, true);
  const unsubscribe = onPythonReset((sessionId) => {
    const model = editor.getModel();
    const doc = model && documents.find(model);
    if (doc?.session.id !== sessionId) return;
    reset();
    editor.getContribution<ContentHover>('editor.contrib.contentHover')?.hideContentHover();
  });
  window.addEventListener('keydown', keys);
  window.addEventListener('keyup', keys);
  window.addEventListener('blur', blur);
  return () => {
    reset();
    unsubscribe();
    for (const subscription of subscriptions) subscription.dispose();
    root.removeEventListener('click', click, true);
    window.removeEventListener('keydown', keys);
    window.removeEventListener('keyup', keys);
    window.removeEventListener('blur', blur);
  };
}
