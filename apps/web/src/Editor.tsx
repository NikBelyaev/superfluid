import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Braces, Save, Download, RefreshCw } from 'lucide-react';
import { documents, monaco, subscribe, getRevision, type Doc } from './documents';
import { useApp, type Location } from './state';
import type { Session } from '../../../packages/contracts';

monaco.editor.defineTheme('superfluid-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '71717A' },
    { token: 'keyword', foreground: '8056A4' },
    { token: 'string', foreground: '397857' },
    { token: 'number', foreground: 'B15F29' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#18181B',
    'editorLineNumber.foreground': '#71717A',
    'editorLineNumber.activeForeground': '#27272A',
    'editor.lineHighlightBackground': '#FAFAFA',
    'editor.selectionBackground': '#DDE9FF',
    'editorCursor.foreground': '#245FDB',
    'editorIndentGuide.background1': '#F4F4F5',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#E4E4E7',
  },
});

async function request(
  model: monaco.editor.ITextModel,
  method: any,
  position?: monaco.Position,
  extra: Record<string, unknown> = {},
) {
  const doc = documents.find(model);
  if (!doc) return null;
  await documents.sync(doc);
  return window.superfluid.call('lsp.request', {
    sessionId: doc.session.id,
    method,
    params: {
      textDocument: { uri: documents.diskUri(doc) },
      ...(position
        ? { position: { line: position.lineNumber - 1, character: position.column - 1 } }
        : {}),
      ...extra,
    },
  });
}
const range = (r: any) =>
  new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
monaco.languages.registerCompletionItemProvider('python', {
  triggerCharacters: ['.'],
  provideCompletionItems: async (model, position, _context, token) => {
    try {
      const result = await request(model, 'textDocument/completion', position);
      if (token.isCancellationRequested) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      return {
        suggestions: (result?.items ?? result ?? []).slice(0, 300).map((i: any) => ({
          label: i.label,
          kind: monaco.languages.CompletionItemKind.Text,
          detail: i.detail,
          documentation: i.documentation,
          insertText: i.textEdit?.newText ?? i.insertText ?? i.label,
          insertTextRules:
            i.insertTextFormat === 2
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : 0,
          range: i.textEdit?.range
            ? range(i.textEdit.range)
            : new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              ),
          sortText: i.sortText,
          filterText: i.filterText,
        })),
      };
    } catch {
      return { suggestions: [] };
    }
  },
});
monaco.languages.registerHoverProvider('python', {
  provideHover: async (model, position, token) => {
    try {
      const r = await request(model, 'textDocument/hover', position);
      if (!r || token.isCancellationRequested) return null;
      const contents = Array.isArray(r.contents) ? r.contents : [r.contents];
      return {
        range: r.range ? range(r.range) : undefined,
        contents: contents.map((c: any) => ({
          value:
            typeof c === 'string'
              ? c
              : c.language
                ? '```' + c.language + '\n' + c.value + '\n```'
                : (c.value ?? ''),
          isTrusted: false,
        })),
      };
    } catch {
      return null;
    }
  },
});
monaco.languages.registerDefinitionProvider('python', {
  provideDefinition: async (model, position, token) => {
    try {
      const r = await request(model, 'textDocument/definition', position);
      if (!r || token.isCancellationRequested) return [];
      return (Array.isArray(r) ? r : [r]).map((d: any) => ({
        uri: monaco.Uri.parse(d.uri ?? d.targetUri),
        range: range(d.range ?? d.targetSelectionRange),
      }));
    } catch {
      return [];
    }
  },
});
monaco.languages.registerDocumentSymbolProvider('python', {
  provideDocumentSymbols: async (model, token) => {
    try {
      const r = await request(model, 'textDocument/documentSymbol');
      if (token.isCancellationRequested) return [];
      const convert = (s: any): monaco.languages.DocumentSymbol => ({
        name: s.name,
        detail: s.detail ?? '',
        kind: monaco.languages.SymbolKind.Class,
        tags: [],
        range: range(s.range ?? s.location.range),
        selectionRange: range(s.selectionRange ?? s.range ?? s.location.range),
        children: s.children?.map(convert),
      });
      return (r ?? []).map(convert);
    } catch {
      return [];
    }
  },
});

export async function navigate(
  session: Session,
  uri: monaco.Uri,
  line: number,
  column: number,
  origin?: Location,
) {
  let path: string;
  if (uri.scheme === 'superfluid-file') {
    if (uri.authority !== session.id)
      throw new Error('This definition belongs to another worktree.');
    path = uri.path.slice(1);
  } else {
    const root = session.path.replace(/\/$/, '') + '/';
    if (!uri.fsPath.startsWith(root))
      throw new Error(
        'This definition is outside the current worktree. Open that source folder as a project to inspect it.',
      );
    path = uri.fsPath.slice(root.length);
  }
  const app = useApp.getState(),
    view = app.views[session.id];
  if (app.sessionId !== session.id) return;
  if (origin) {
    const history = view.history.slice(0, view.historyIndex + 1);
    if (
      !history.length ||
      history.at(-1)?.path !== origin.path ||
      history.at(-1)?.line !== origin.line
    )
      history.push(origin);
    app.setView({ history, historyIndex: history.length - 1 }, session.id);
  }
  await app.openFile(path, line, column, true);
}

export default function Editor({
  session,
  path,
  primary = true,
}: {
  session: Session;
  path: string | null;
  primary?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    bound = useRef<Doc | null>(null);
  const capture = useRef<() => void>(() => {});
  const [doc, setDoc] = useState<Doc | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const revision = useApp((a) => a.revision);
  useSyncExternalStore(subscribe, getRevision);
  useEffect(() => {
    if (!host.current) return;
    const appearance = getComputedStyle(document.documentElement);
    const instance = monaco.editor.create(host.current, {
      theme: 'superfluid-light',
      model: null,
      fontFamily: appearance.getPropertyValue('--font-mono').trim(),
      fontSize: parseFloat(appearance.getPropertyValue('--font-size-editor')),
      lineHeight: 22,
      minimap: { enabled: false },
      padding: { top: 14, bottom: 20 },
      scrollBeyondLastLine: false,
      smoothScrolling: false,
      automaticLayout: true,
      renderLineHighlight: 'line',
      overviewRulerBorder: false,
      roundedSelection: false,
      tabSize: 4,
      wordWrap: 'off',
      guides: { indentation: true },
      bracketPairColorization: { enabled: true },
    });
    editor.current = instance;
    const remember = () => {
      const d = bound.current;
      if (!d || d.model.isDisposed()) return;
      const saved = instance.saveViewState();
      if (!saved) return;
      const view = useApp.getState().views[d.session.id];
      if (!view) return;
      const key = (primary ? 'main:' : 'side:') + d.path;
      const persisted = {
        ...saved,
        cursorState: saved.cursorState.slice(0, 16),
        contributionsState: {},
      };
      if (JSON.stringify(view.editorViews?.[key]) === JSON.stringify(persisted)) return;
      useApp.getState().setView(
        {
          editorViews: Object.fromEntries([
            ...Object.entries(view.editorViews ?? {})
              .filter(([path]) => path !== key)
              .slice(-159),
            [key, persisted],
          ]),
        },
        d.session.id,
      );
    };
    capture.current = remember;
    const unregister = documents.registerViewReader(remember);
    const save = instance.addAction({
      id: 'superfluid.save',
      label: 'Save file',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const d = bound.current;
        if (d) return documents.save(d).catch(useApp.getState().fail);
      },
    });
    const rename = instance.addAction({
      id: 'superfluid.rename',
      label: 'Rename symbol…',
      keybindings: [monaco.KeyCode.F2],
      run: () => {
        const d = bound.current,
          p = instance.getPosition();
        if (d && p)
          useApp.setState({
            modal: {
              kind: 'rename-symbol',
              source: { path: d.path, line: p.lineNumber, column: p.column },
            },
          });
      },
    });
    const format = instance.addAction({
      id: 'superfluid.format',
      label: 'Format Python with Ruff',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: async () => {
        const d = bound.current;
        if (!d) return;
        const version = d.version;
        try {
          const text = await window.superfluid.call('python.format', {
            sessionId: d.session.id,
            text: d.model.getValue(),
          });
          if (d.version !== version)
            throw new Error('The document changed while formatting. Try again.');
          d.model.pushEditOperations(
            [],
            [{ range: d.model.getFullModelRange(), text }],
            () => null,
          );
        } catch (e) {
          useApp.getState().fail(e);
        }
      },
    });
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: async (source, resource, selection) => {
        if (source !== instance || !bound.current) return false;
        const p = source.getPosition()!;
        const d = bound.current;
        try {
          await navigate(
            d.session,
            resource,
            'startLineNumber' in (selection ?? {})
              ? (selection as monaco.IRange).startLineNumber
              : ((selection as monaco.IPosition)?.lineNumber ?? 1),
            'startColumn' in (selection ?? {})
              ? (selection as monaco.IRange).startColumn
              : ((selection as monaco.IPosition)?.column ?? 1),
            {
              path: d.path,
              line: p.lineNumber,
              column: p.column,
              label: d.path.split('/').at(-1)!,
            },
          );
        } catch (e) {
          useApp.getState().fail(e);
        }
        return true;
      },
    });
    const focus = instance.onDidFocusEditorText(() => {
      documents.focused = bound.current;
    });
    return () => {
      remember();
      unregister();
      capture.current = () => {};
      save.dispose();
      rename.dispose();
      format.dispose();
      opener.dispose();
      focus.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    let cancelled = false;
    capture.current();
    if (documents.focused === bound.current) documents.focused = null;
    if (!path) {
      editor.current?.setModel(null);
      bound.current = null;
      setDoc(null);
      return;
    }
    setLoading(true);
    setError('');
    editor.current?.setModel(null);
    bound.current = null;
    setDoc(null);
    void documents
      .open(session, path)
      .then((d) => {
        if (cancelled || !editor.current) return;
        bound.current = d;
        setDoc(d);
        editor.current.setModel(d.model);
        const saved =
          useApp.getState().views[session.id]?.editorViews?.[(primary ? 'main:' : 'side:') + path];
        if (saved) editor.current.restoreViewState(saved);
        if (d.reveal) {
          editor.current.setPosition({ lineNumber: d.reveal.line, column: d.reveal.column });
          editor.current.revealLineInCenterIfOutsideViewport(d.reveal.line);
          d.reveal = undefined;
        }
        editor.current.focus();
        documents.focused = d;
        setLoading(false);
        performance.mark('superfluid:editor-bound');
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, path, primary ? revision : 0]);
  return (
    <div
      className="editor-pane"
      {...(primary
        ? { role: 'tabpanel', id: 'primary-editor-panel', 'aria-label': path ?? 'Editor' }
        : {})}
    >
      <div className="breadcrumb">
        <Braces size={13} />
        <span>{session.branch || 'Project'}</span>
        <span>/</span>
        <span>{path ?? 'No file selected'}</span>
        <div className="spacer" />
        {doc && (
          <button
            className="icon-button"
            title="Reload disk version…"
            onClick={() => {
              if (!doc.dirty || confirm('Discard these edits and reload the disk version?'))
                void documents.reload(doc).catch(useApp.getState().fail);
            }}
          >
            <RefreshCw size={13} />
          </button>
        )}
        {doc && (
          <button
            className="icon-button"
            title="Export buffer…"
            onClick={() =>
              void window.superfluid
                .exportText(doc.model.getValue(undefined, true), doc.path.split('/').at(-1)!)
                .catch(useApp.getState().fail)
            }
          >
            <Download size={14} />
          </button>
        )}
        {doc?.dirty && (
          <>
            <span className="unsaved">Unsaved</span>
            <button
              className="icon-button"
              title="Save file (⌘S)"
              onClick={() => void documents.save(doc).catch(useApp.getState().fail)}
            >
              <Save size={14} />
            </button>
          </>
        )}
      </div>
      {doc?.recovered && (
        <div className="recovery-banner">
          <AlertCircle size={14} />
          {doc.diskText === undefined
            ? 'Recovered unsaved changes. The disk version is unavailable; export this buffer to keep it.'
            : 'Recovered unsaved changes. Save to write them to disk.'}
          <button
            onClick={() => {
              if (confirm('Discard these edits and reload the disk version?'))
                void documents.reload(doc).catch(useApp.getState().fail);
            }}
          >
            Reload disk
          </button>
        </div>
      )}
      <div className="editor-host" ref={host} />
      {loading && <div className="editor-message">Opening file…</div>}
      {error && <div className="editor-message error-text">{error}</div>}
      {!path && (
        <div className="editor-empty">
          <h2>Open a file</h2>
          <p>Choose a file from the project tree or use a shortcut.</p>
          <div className="shortcut-row">
            <span>Find a file</span>
            <kbd>⌘ P</kbd>
          </div>
          <div className="shortcut-row">
            <span>All commands</span>
            <kbd>⌘ ⇧ P</kbd>
          </div>
          <div className="shortcut-row">
            <span>Search project</span>
            <kbd>⌘ ⇧ F</kbd>
          </div>
        </div>
      )}
    </div>
  );
}
