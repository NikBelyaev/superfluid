import type { PythonImport } from '@superfluid/contracts';
import { documents, monaco, type Doc } from '~/state/editor/Documents';
import { callPython } from '~/rpc/python';
import { pythonGeneration } from '~/state/python';
import { useApp } from '~/state/workspaceStore';
import type { ContentHover } from './definitionLinks';
import './imports.css';
import { showChoiceMenu } from '~/components/editor/choiceMenu';
import { keycap } from '~/components/editor/surfaceElements';

const command = 'superfluid.applyImport';
type Args = [string, number, number, PythonImport['edits']];
type Ready = {
  doc: Doc;
  version: number;
  generation: number;
  actions: PythonImport[];
};
let focusedEditor: monaco.editor.IStandaloneCodeEditor | undefined;
const cache = new WeakMap<
  monaco.editor.ITextModel,
  {
    version: number;
    generation: number;
    range: monaco.Range;
    controller: AbortController;
    promise: Promise<Ready | undefined>;
    ready?: Ready;
  }
>();

function importsAt(doc: Doc, position: monaco.IPosition) {
  const model = doc.model;
  const word = model.getWordAtPosition(position);
  if (!word || doc.readOnly || doc.closed || model.isDisposed()) return;
  const range = new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
  const previous = cache.get(model);
  if (
    previous?.version === doc.version &&
    previous.generation === pythonGeneration(doc.session.id) &&
    previous.range.equalsRange(range) &&
    !previous.controller.signal.aborted
  )
    return previous.promise;
  previous?.controller.abort();
  const entry: NonNullable<ReturnType<typeof cache.get>> = {
    version: doc.version,
    generation: pythonGeneration(doc.session.id),
    range,
    controller: new AbortController(),
    promise: Promise.resolve(undefined),
  };
  cache.set(model, entry);
  entry.promise = (async () => {
    try {
      await documents.sync(doc);
      await documents.recovery.flushAll();
      if (entry.controller.signal.aborted || doc.version !== entry.version) return;
      entry.generation = pythonGeneration(doc.session.id);
      const actions = await callPython(
        'python.imports',
        {
          sessionId: doc.session.id,
          path: doc.path,
          text: model.getValue(undefined, true),
          version: entry.version,
          position: { line: position.lineNumber - 1, character: word.startColumn - 1 },
        },
        entry.controller.signal,
      );
      if (
        entry.controller.signal.aborted ||
        model.isDisposed() ||
        doc.closed ||
        doc.version !== entry.version ||
        pythonGeneration(doc.session.id) !== entry.generation
      )
        return;
      return (entry.ready = { doc, version: entry.version, generation: entry.generation, actions });
    } catch (error) {
      if (cache.get(model) === entry) cache.delete(model);
      if (!entry.controller.signal.aborted) throw error;
    }
  })();
  return entry.promise;
}

function importLabel(action: PythonImport) {
  return (
    action.edits
      .flatMap((edit) => edit.newText.split('\n'))
      .find((line) => /^(from |import )/.test(line)) ?? action.title
  );
}

function unresolvedAt(model: monaco.editor.ITextModel, position: monaco.IPosition) {
  return monaco.editor
    .getModelMarkers({ owner: 'python', resource: model.uri })
    .find(
      (marker) =>
        ['unresolved-reference', 'reportUndefinedVariable'].includes(
          typeof marker.code === 'string' ? marker.code : (marker.code?.value ?? ''),
        ) && monaco.Range.containsPosition(marker, position),
    );
}

async function applyImport([uri, version, generation, edits]: Args) {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  const doc = model && documents.find(model);
  if (
    !doc ||
    doc.readOnly ||
    doc.closed ||
    doc.version !== version ||
    useApp.getState().sessionId !== doc.session.id
  )
    throw new Error('The document changed. Request the import again.');
  await documents.applyWorkspaceEdit(doc.session, {
    generation,
    documentChanges: [{ textDocument: { uri: documents.diskUri(doc), version }, edits }],
  });
  const editor = monaco.editor
    .getEditors()
    .find((editor) => editor.getModel() === model && editor.hasWidgetFocus());
  editor?.getContribution<ContentHover>('editor.contrib.contentHover')?.hideContentHover();
  editor?.focus();
}
monaco.editor.registerCommand(command, (_accessor, ...args: Args) =>
  applyImport(args).catch(useApp.getState().fail),
);

monaco.languages.registerHoverProvider('python', {
  provideHover: async (model, position, token) => {
    const doc = documents.find(model);
    const marker = unresolvedAt(model, position);
    if (!doc || doc.readOnly || doc.closed || !marker || token.isCancellationRequested) return null;
    try {
      const ready = await importsAt(doc, position);
      if (
        !ready?.actions.length ||
        token.isCancellationRequested ||
        doc.closed ||
        doc.version !== ready.version ||
        pythonGeneration(doc.session.id) !== ready.generation
      )
        return null;
      return {
        range: monaco.Range.lift(marker),
        contents: [
          {
            value:
              '**Quick fix**\n\n' +
              ready.actions
                .map((action, index) => {
                  const args: Args = [
                    model.uri.toString(),
                    ready.version,
                    ready.generation,
                    action.edits,
                  ];
                  const label = importLabel(action).replace(/[\\`*_{}\[\]()<>]/g, '\\$&');
                  const shortcut =
                    index < 9
                      ? `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}${index + 1}`
                      : '';
                  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify(args))}${shortcut ? ` "${shortcut}"` : ''})`;
                })
                .join('\n\n'),
            isTrusted: { enabledCommands: [command] },
          },
        ],
      };
    } catch {
      return null;
    }
  },
});

monaco.languages.registerCodeActionProvider(
  'python',
  {
    provideCodeActions: async (model, range, context, token) => {
      const doc = documents.find(model);
      if (!doc || doc.closed || doc.readOnly) return null;
      try {
        const ready =
          context.trigger === monaco.languages.CodeActionTriggerType.Invoke
            ? await importsAt(doc, range.getStartPosition())
            : cache.get(model)?.ready;
        const entry = cache.get(model);
        if (
          !ready ||
          !entry ||
          token.isCancellationRequested ||
          ready.version !== doc.version ||
          ready.generation !== pythonGeneration(doc.session.id) ||
          !range.intersectRanges(entry.range)
        )
          return null;
        return {
          actions: ready.actions.map((action) => ({
            title: importLabel(action),
            kind: 'quickfix',
            command: {
              id: command,
              title: action.title,
              arguments: [
                model.uri.toString(),
                ready.version,
                ready.generation,
                action.edits,
              ] satisfies Args,
            },
          })),
          // Hover and the explicit chooser share these versioned edits.
          dispose() {},
        };
      } catch {
        return null;
      }
    },
  },
  { providedCodeActionKinds: ['quickfix'] },
);

export async function importSymbol(editor = focusedEditor) {
  const model = editor?.getModel();
  const doc = model && documents.find(model);
  const position = editor?.getPosition();
  if (
    !editor ||
    !position ||
    !doc ||
    doc.readOnly ||
    doc.closed ||
    model?.getLanguageId() !== 'python' ||
    doc.session.id !== useApp.getState().sessionId
  )
    return;
  editor.focus();
  try {
    const ready = await importsAt(doc, position);
    if (
      !ready?.actions.length ||
      doc.version !== ready.version ||
      doc.closed ||
      editor.getModel() !== model ||
      !editor.getPosition()?.equals(position) ||
      useApp.getState().sessionId !== doc.session.id
    )
      return;
    editor.getContribution<ContentHover>('editor.contrib.contentHover')?.hideContentHover();
    editor.trigger('superfluid', 'hideSuggestWidget', {});
    showChoiceMenu(
      editor,
      ready.actions.map((action) => ({ label: importLabel(action) })),
      (index) => {
        void applyImport([
          model.uri.toString(),
          ready.version,
          ready.generation,
          ready.actions[index]!.edits,
        ]).catch(useApp.getState().fail);
      },
    );
  } catch (error) {
    useApp.getState().fail(error);
  }
}

export function installImportActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  root: HTMLElement,
) {
  editor.updateOptions({ lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off } });
  const mac = navigator.platform.includes('Mac');
  const quickFixShortcut = (event: KeyboardEvent) => {
    if (event.isComposing || event.repeat || event.altKey || event.shiftKey) return;
    const modifier = event.key === (mac ? 'Meta' : 'Control');
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (
      !modifier &&
      (!digit || (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey))
    )
      return;
    const hoverVisible = editor.getContribution<ContentHover>(
      'editor.contrib.contentHover',
    )?.isHoverVisible;
    const links = [
      ...root.querySelectorAll<HTMLAnchorElement>(
        '.monaco-hover a[data-href^="command:superfluid.applyImport"], .monaco-hover a[title="Open definition"]',
      ),
    ].filter((link) => hoverVisible && link.getClientRects().length > 0);
    const rows = [
      ...root.querySelectorAll<HTMLElement>('.editor-choice-menu [role="option"]'),
    ].filter((row) => row.getClientRects().length > 0);
    if (!links.length && !rows.length) return;
    if (modifier) {
      // Keep Cmd-hover navigation from rebuilding the card before the digit arrives.
      event.stopPropagation();
      return;
    }
    const link = digit && (links.length ? links : rows)[Number(digit[1]) - 1];
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    link.click();
  };
  root.addEventListener('keydown', quickFixShortcut, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let target = '';
  let dismissed = '';
  let anchor: monaco.IPosition | undefined;
  let shown = false;
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className =
    'python-import-hint flex cursor-pointer items-center gap-3 whitespace-nowrap rounded-[var(--control-radius)] border border-solid border-border bg-popover px-2 py-1.5 font-sans text-xs leading-[18px] text-foreground shadow-[var(--shadow-popover)] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const label = document.createElement('span');
  const key = keycap(navigator.platform.includes('Mac') ? '⌥↵' : 'Alt+Enter');
  hint.append(label, key);
  const node = document.createElement('div');
  node.className = 'python-import-widget w-max';
  node.append(hint);
  const widget: monaco.editor.IContentWidget = {
    suppressMouseDown: true,
    getId: () => 'superfluid.importHint',
    getDomNode: () => node,
    getPosition: () =>
      anchor
        ? {
            position: anchor,
            preference: [
              monaco.editor.ContentWidgetPositionPreference.ABOVE,
              monaco.editor.ContentWidgetPositionPreference.BELOW,
            ],
          }
        : null,
  };
  const hide = () => {
    clearTimeout(timer);
    if (shown) editor.removeContentWidget(widget);
    shown = false;
  };
  hint.onclick = () => {
    hide();
    void importSymbol(editor);
  };
  const schedule = () => {
    clearTimeout(timer);
    const model = editor.getModel();
    const doc = model && documents.find(model);
    const position = editor.getPosition();
    const marker = model && position && unresolvedAt(model, position);
    if (
      !editor.hasTextFocus() ||
      root.querySelector('.suggest-widget.visible') ||
      !doc ||
      doc.closed ||
      doc.readOnly ||
      !marker ||
      !position ||
      !editor.getSelection()?.isEmpty() ||
      doc.session.id !== useApp.getState().sessionId
    ) {
      target = '';
      hide();
      return;
    }
    const next = `${model.uri}:${doc.version}:${pythonGeneration(doc.session.id)}:${marker.startLineNumber}:${marker.startColumn}`;
    if (next !== target) {
      hide();
      target = next;
      dismissed = '';
    }
    if (dismissed === target || shown) return;
    timer = setTimeout(() => {
      void importsAt(doc, position)
        ?.then((ready) => {
          if (
            !ready?.actions.length ||
            target !== next ||
            dismissed === next ||
            doc.version !== ready.version ||
            editor.getModel() !== model ||
            !editor.hasTextFocus() ||
            root.querySelector('.suggest-widget.visible') ||
            !editor.getPosition() ||
            !monaco.Range.containsPosition(marker, editor.getPosition()!)
          )
            return;
          label.textContent = `Import ${model.getWordAtPosition(position)?.word ?? 'symbol'}`;
          hint.setAttribute('aria-label', label.textContent);
          anchor = { lineNumber: marker.startLineNumber, column: marker.startColumn };
          shown = true;
          editor.addContentWidget(widget);
        })
        .catch(() => {});
    }, 500);
  };
  const action = editor.addAction({
    id: 'superfluid.importSymbol',
    label: 'Import symbol…',
    precondition: 'editorLangId == python && !editorReadonly',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Enter],
    run: () => {
      hide();
      return importSymbol(editor);
    },
  });
  const subscriptions = [
    editor.onDidFocusEditorText(() => {
      focusedEditor = editor;
      schedule();
    }),
    editor.onDidChangeModel(schedule),
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (model) {
        cache.get(model)?.controller.abort();
        cache.delete(model);
      }
      schedule();
    }),
    editor.onDidChangeCursorPosition(schedule),
    editor.onDidBlurEditorText(hide),
    monaco.editor.onDidChangeMarkers((uris) => {
      if (uris.some((uri) => uri.toString() === editor.getModel()?.uri.toString())) schedule();
    }),
    editor.onKeyDown((event) => {
      if (event.keyCode === monaco.KeyCode.Escape && shown) {
        dismissed = target;
        hide();
      }
    }),
  ];
  schedule();
  return () => {
    hide();
    root.removeEventListener('keydown', quickFixShortcut, true);
    for (const subscription of subscriptions) subscription.dispose();
    action.dispose();
    if (focusedEditor === editor) focusedEditor = undefined;
  };
}
