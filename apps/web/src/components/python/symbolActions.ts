import type { PythonHover, PythonLocation } from '@superfluid/contracts';
import { callPython } from '~/rpc/python';
import { desktop } from '~/rpc/desktop';
import { documents, monaco, type Doc } from '~/state/editor/Documents';
import { pythonGeneration } from '~/state/python';
import { useApp, openPalette } from '~/state/workspaceStore';
import type { ContentHover } from './definitionLinks';
import type { DocumentSymbol } from './symbols';
import { navigate } from './navigation';
import { openDefinition } from './definitionPreview';
import {
  isSymbolDeclaration,
  symbolActionPolicy,
  symbolReference,
  type SymbolAction,
} from './symbolActionPolicy';

const command = 'superfluid.symbolAction';
type Args = [
  SymbolAction,
  string,
  number,
  PythonLocation['position'],
  number,
  PythonHover['definitions'],
];

function actionsAt(
  doc: Doc,
  position: PythonLocation['position'],
  definitions: PythonHover['definitions'],
) {
  const word = doc.model.getWordAtPosition({
    lineNumber: position.line + 1,
    column: position.character + 1,
  });
  if (!word) return;
  const uri = documents.diskUri(doc);
  const start = { line: position.line, character: word.startColumn - 1 };
  const actions = symbolActionPolicy({
    name: word.word,
    prefix: doc.model.getLineContent(position.line + 1).slice(0, start.character),
    uri,
    position: start,
    definitions,
  });
  const definition =
    definitions.find((definition) => isSymbolDeclaration(definition, uri, start, word.word)) ??
    (definitions.length === 1 ? definitions[0] : undefined);
  return { name: word.word, actions, definition };
}

const actionLabels = {
  rename: ['edit', 'Rename'],
  'rename-alias': ['edit', 'Rename alias'],
  definition: ['go-to-file', 'Go to definition'],
  'choose-definition': ['list-selection', 'Choose definition'],
  search: ['search', 'Search'],
  copy: ['references', 'Copy reference'],
  'copy-name': ['copy', 'Copy name'],
  delete: ['trash', 'Delete definition'],
} as const;

export function symbolActions(doc: Doc, position: PythonLocation['position'], hover: PythonHover) {
  const context = actionsAt(doc, position, hover.definitions);
  if (!context) return { value: '' };
  const link = (action: SymbolAction) => {
    const args: Args = [
      action,
      doc.model.uri.toString(),
      doc.version,
      position,
      pythonGeneration(doc.session.id),
      hover.definitions,
    ];
    const [icon, label] = actionLabels[action];
    return `[$(${icon}) ${label}](command:${command}?${encodeURIComponent(JSON.stringify(args))})`;
  };
  return {
    value: context.actions
      .filter((action) => ['definition', 'search', 'copy', 'copy-name'].includes(action))
      .map(link)
      .join(' '),
    supportThemeIcons: true,
    isTrusted: { enabledCommands: [command] },
  };
}

export function renameSymbol(
  editor: monaco.editor.ICodeEditor,
  doc: Doc,
  position: monaco.IPosition,
) {
  const word = doc.model.getWordAtPosition(position);
  if (!word || doc.readOnly) return;
  editor.focus();
  const version = doc.version;
  const generation = pythonGeneration(doc.session.id);
  const form = document.createElement('form');
  form.className = 'symbol-rename relative m-0 w-max p-0';
  editor.applyFontInfo(form);
  const field = document.createElement('div');
  field.className = 'grid w-max';
  // Keep the original token covered when the draft becomes shorter.
  const originalName = document.createElement('span');
  originalName.className = 'invisible col-start-1 row-start-1 whitespace-pre';
  originalName.setAttribute('aria-hidden', 'true');
  originalName.textContent = word.word;
  const input = document.createElement('input');
  input.className =
    'col-start-1 row-start-1 [field-sizing:content] m-0 h-[1lh] min-w-full w-auto rounded-[var(--control-radius)] border-0 bg-[var(--vscode-editor-background)] p-0 [font:inherit] [font-feature-settings:inherit] [font-variation-settings:inherit] tracking-[inherit] text-[var(--vscode-editor-foreground)] shadow-none outline-1 outline-offset-0 outline-ring';
  input.setAttribute('aria-label', 'New symbol name');
  input.setAttribute('aria-description', 'Enter to rename. Escape to cancel.');
  input.value = word.word;
  input.required = true;
  const error = document.createElement('div');
  error.className =
    'absolute top-full mt-1 w-max max-w-[300px] rounded-[var(--control-radius)] border border-solid border-border bg-popover px-2 py-1 font-sans text-xs text-diff-deletion-foreground';
  error.id = `${editor.getId()}-rename-error`;
  error.setAttribute('role', 'alert');
  error.hidden = true;
  field.append(originalName, input);
  form.append(field, error);
  let focused = false;
  const widget: monaco.editor.IContentWidget = {
    suppressMouseDown: true,
    getId: () => 'superfluid.inlineRename',
    getDomNode: () => form,
    getPosition: () => ({
      position: { lineNumber: position.lineNumber, column: word.startColumn },
      preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
    }),
    afterRender: (placement) => {
      if (placement === null || focused) return;
      focused = true;
      input.focus();
      input.select();
    },
  };
  let closed = false;
  const outsidePointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && !form.contains(event.target)) close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outsidePointerDown, true);
    for (const subscription of subscriptions) subscription.dispose();
    editor.removeContentWidget(widget);
  };
  const subscriptions = [
    editor.onDidChangeModel(close),
    editor.onDidChangeModelContent(close),
    editor.onDidDispose(close),
  ];
  document.addEventListener('pointerdown', outsidePointerDown, true);
  form.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      editor.focus();
    }
  };
  form.onfocusout = () => {
    if (!form.contains(document.activeElement)) close();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (input.readOnly) return;
    input.readOnly = true;
    try {
      if (
        doc.version !== version ||
        pythonGeneration(doc.session.id) !== generation ||
        editor.getModel() !== doc.model ||
        useApp.getState().sessionId !== doc.session.id
      )
        throw new Error('The document changed. Try renaming again.');
      const edit = await documents.prepareRename(
        doc.session,
        { path: doc.path, line: position.lineNumber, column: position.column },
        input.value,
      );
      if (!form.isConnected) return;
      await documents.applyWorkspaceEdit(doc.session, edit);
      close();
      if (editor.getModel() === doc.model && useApp.getState().sessionId === doc.session.id)
        editor.focus();
    } catch (e) {
      if (closed) return;
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
      input.readOnly = false;
      input.focus();
      editor.layoutContentWidget(widget);
    }
  };
  editor.setPosition(position);
  editor.addContentWidget(widget);
  editor.render();
}

async function run(
  editor: monaco.editor.ICodeEditor,
  [action, uri, version, position, generation, definitions]: Args,
) {
  const model = editor.getModel();
  const doc = model && documents.find(model);
  if (
    !doc ||
    doc.readOnly ||
    model!.uri.toString() !== uri ||
    doc.version !== version ||
    pythonGeneration(doc.session.id) !== generation ||
    useApp.getState().sessionId !== doc.session.id
  )
    return;
  const context = actionsAt(doc, position, definitions);
  if (!context?.actions.includes(action)) return;
  const { name, definition } = context;
  if (action === 'choose-definition') {
    editor.setPosition({ lineNumber: position.line + 1, column: position.character + 1 });
    const candidate = editor
      .getDomNode()
      ?.querySelector<HTMLElement>('.monaco-hover a[title="Open definition"]');
    if (
      candidate &&
      editor.getContribution<ContentHover>('editor.contrib.contentHover')?.isHoverVisible
    )
      candidate.focus();
    else editor.trigger('symbolActions', 'editor.action.showHover', { focus: true });
    return;
  }
  editor.getContribution<ContentHover>('editor.contrib.contentHover')?.hideContentHover();
  const point = { lineNumber: position.line + 1, column: position.character + 1 };
  if (action === 'rename' || action === 'rename-alias') return renameSymbol(editor, doc, point);
  if (action === 'definition' && definition)
    return openDefinition(uri, version, position, definition.symbol, generation);
  if (action === 'search') return openPalette('search', name);
  if (action === 'copy' || action === 'copy-name') {
    return desktop.copyText(
      action === 'copy' && definition ? symbolReference(definition, name) : name,
    );
  }
  if (action !== 'delete' || !definition) return;
  const target = monaco.Uri.parse(definition.symbol.uri);
  const root = doc.session.path.replace(/\/$/, '') + '/';
  if (target.scheme !== 'file' || !target.fsPath.startsWith(root))
    throw new Error('External definitions are read only.');
  const destination = await documents.open(doc.session, target.fsPath.slice(root.length));
  const targetVersion = destination.version;
  await documents.sync(destination);
  const symbols: DocumentSymbol[] = await callPython('lsp.request', {
    sessionId: doc.session.id,
    method: 'textDocument/documentSymbol',
    params: { textDocument: { uri: target.toString() } },
  });
  const find = (symbols: DocumentSymbol[]): DocumentSymbol | undefined => {
    for (const symbol of symbols) {
      const p = definition.symbol.position,
        { start, end } = symbol.range;
      if (
        (p.line > start.line || (p.line === start.line && p.character >= start.character)) &&
        (p.line < end.line || (p.line === end.line && p.character < end.character))
      )
        return (
          find(symbol.children ?? []) ??
          (symbol.name === definition.symbol.name ? symbol : undefined)
        );
    }
  };
  const symbol = find(symbols ?? []);
  if (!symbol) throw new Error('Python could not locate this definition.');
  const { start, end } = symbol.range;
  const range = new monaco.Range(
    start.line + 1,
    1,
    end.line + (end.line + 1 < destination.model.getLineCount() ? 2 : 1),
    end.line + 1 < destination.model.getLineCount()
      ? 1
      : destination.model.getLineMaxColumn(end.line + 1),
  );
  if (
    doc.version !== version ||
    editor.getModel() !== doc.model ||
    useApp.getState().sessionId !== doc.session.id
  )
    throw new Error('The document changed. Try deleting again.');
  await documents.applyWorkspaceEdit(doc.session, {
    generation,
    documentChanges: [
      {
        textDocument: { uri: target.toString(), version: targetVersion },
        edits: [
          {
            range: {
              start: { line: range.startLineNumber - 1, character: 0 },
              end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
            },
            newText: '',
          },
        ],
      },
    ],
  });
  await navigate(doc.session, target, start.line + 1, 1, {
    path: doc.path,
    line: point.lineNumber,
    column: point.column,
    label: doc.path.split('/').at(-1)!,
  });
}

monaco.editor.registerCommand(command, (_accessor, ...args: Args) => {
  const editors = monaco.editor
    .getEditors()
    .filter((editor) => editor.getModel()?.uri.toString() === args[1]);
  const editor = editors.find((editor) => editor.hasWidgetFocus()) ?? editors[0];
  if (editor) void run(editor, args).catch(useApp.getState().fail);
});

function installSymbolContextMenu(editor: monaco.editor.IStandaloneCodeEditor, root: HTMLElement) {
  let invoke: ((action: SymbolAction) => Promise<void>) | undefined;
  let pending: AbortController | undefined;
  const actions = (Object.keys(actionLabels) as SymbolAction[])
    .filter((action) => action !== 'definition')
    .map((action, index) => {
      const available = editor.createContextKey<boolean>(`superfluid.symbol.${action}`, false);
      const registration = editor.addAction({
        id: `superfluid.symbol.${action}`,
        label: actionLabels[action][1],
        precondition: `superfluid.symbol.${action}`,
        contextMenuGroupId: 'navigation',
        contextMenuOrder: index - 100,
        run: () => invoke?.(action).catch(useApp.getState().fail),
      });
      return { action, available, registration };
    });
  const cancel = () => {
    pending?.abort();
    pending = undefined;
  };
  const prepare = async (point = editor.getPosition()) => {
    cancel();
    invoke = undefined;
    for (const { available } of actions) available.set(false);
    editor.getContribution<ContentHover>('editor.contrib.contentHover')?.hideContentHover();
    const controller = (pending = new AbortController());
    const model = editor.getModel();
    const doc = model && documents.find(model);
    if (
      doc &&
      !doc.readOnly &&
      model?.getLanguageId() === 'python' &&
      point &&
      model.getWordAtPosition(point)
    ) {
      const version = doc.version;
      const generation = pythonGeneration(doc.session.id);
      const position = { line: point.lineNumber - 1, character: point.column - 1 };
      try {
        await documents.sync(doc);
        const hover = await callPython(
          'python.hover',
          {
            sessionId: doc.session.id,
            path: doc.path,
            position,
          },
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          editor.getModel() !== model ||
          doc.version !== version ||
          pythonGeneration(doc.session.id) !== generation ||
          useApp.getState().sessionId !== doc.session.id
        )
          return false;
        const definitions = hover?.definitions ?? [];
        const context = actionsAt(doc, position, definitions);
        invoke = (action) =>
          run(editor, [action, model.uri.toString(), version, position, generation, definitions]);
        for (const { action, available } of actions)
          available.set(!!context?.actions.includes(action));
      } catch (error) {
        if (controller.signal.aborted) return false;
        useApp.getState().fail(error);
      }
    }
    if (controller.signal.aborted) return false;
    pending = undefined;
    return true;
  };
  const show = async (anchor?: { x: number; y: number }, point = editor.getPosition()) => {
    if (!(await prepare(point))) return;
    editor
      .getContribution<
        monaco.editor.IEditorContribution & {
          showContextMenu(anchor?: { x: number; y: number }): void;
        }
      >('editor.contrib.contextmenu')
      ?.showContextMenu(anchor);
    for (const label of root.querySelectorAll<HTMLElement>(
      '.monaco-menu .action-label[aria-label]',
    )) {
      if (label.dataset.symbolAction) continue;
      const entry = Object.entries(actionLabels).find(
        ([, [, name]]) => name === label.getAttribute('aria-label'),
      );
      if (!entry) continue;
      label.dataset.symbolAction = entry[0];
      const icon = document.createElement('span');
      icon.className = `codicon codicon-${entry[1][0]}`;
      icon.setAttribute('aria-hidden', 'true');
      label.replaceChildren(icon, document.createTextNode(entry[1][1]));
      const item = label.closest<HTMLElement>('.action-menu-item');
      item?.setAttribute('aria-label', entry[1][1]);
    }
  };
  const contextMenu = (event: MouseEvent) => {
    const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
    if (
      !target ||
      ![
        monaco.editor.MouseTargetType.CONTENT_TEXT,
        monaco.editor.MouseTargetType.CONTENT_EMPTY,
        monaco.editor.MouseTargetType.TEXTAREA,
      ].includes(target.type)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.focus();
    if (target.position && !editor.getSelection()?.containsPosition(target.position))
      editor.setPosition(target.position);
    void show({ x: event.clientX, y: event.clientY }, target.position ?? editor.getPosition());
  };
  const keyboard = (event: KeyboardEvent) => {
    const mac = navigator.platform.includes('Mac');
    const search =
      event.key === 'F12' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    const copy =
      event.code === 'KeyC' &&
      event.shiftKey &&
      event.altKey &&
      (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
    if (editor.hasTextFocus() && !event.isComposing && !event.repeat && (search || copy)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void prepare()
        .then((ready) => {
          if (!ready) return;
          const action = search
            ? 'search'
            : actions.find((item) => item.action === 'copy')?.available.get()
              ? 'copy'
              : 'copy-name';
          return invoke?.(action);
        })
        .catch(useApp.getState().fail);
      return;
    }
    if (
      !editor.hasTextFocus() ||
      !(
        event.key === 'ContextMenu' ||
        (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void show();
  };
  const subscriptions = [
    editor.onMouseDown(cancel),
    editor.onDidChangeModel(cancel),
    editor.onDidChangeModelContent(cancel),
    editor.onDidBlurEditorText(cancel),
    editor.onKeyDown((event) => {
      if (event.keyCode === monaco.KeyCode.Escape) cancel();
    }),
  ];
  root.addEventListener('contextmenu', contextMenu, true);
  root.addEventListener('keydown', keyboard, true);
  return () => {
    cancel();
    root.removeEventListener('contextmenu', contextMenu, true);
    root.removeEventListener('keydown', keyboard, true);
    for (const subscription of subscriptions) subscription.dispose();
    for (const { available, registration } of actions) {
      available.reset();
      registration.dispose();
    }
  };
}

export function installSymbolActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  root: HTMLElement,
) {
  const removeContextMenu = installSymbolContextMenu(editor, root);
  const selector = `a[data-href^="command:${command}?"]`;
  const click = (event: MouseEvent) => {
    const link =
      event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
    if (!link || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void run(
      editor,
      JSON.parse(decodeURIComponent(link.dataset.href!.split('?')[1])) as Args,
    ).catch(useApp.getState().fail);
  };
  root.addEventListener('click', click, true);
  return () => {
    removeContextMenu();
    root.removeEventListener('click', click, true);
  };
}
