import { desktop } from '~/rpc/desktop';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Braces, Save, Download, RefreshCw } from 'lucide-react';
import { documents, monaco, subscribe, getRevision, type Doc } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import { editorTheme, useAppearance, useSystemDark } from '~/state/appearance';
import type { Session } from '@superfluid/contracts';
import './theme';
import '~/components/python/languageProviders';
import { navigate } from '~/components/python/navigation';

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
  const theme = editorTheme(useAppearance(), useSystemDark());
  useEffect(() => monaco.editor.setTheme(theme), [theme]);
  useSyncExternalStore(subscribe, getRevision);
  useEffect(() => {
    if (!host.current) return;
    const appearance = getComputedStyle(document.documentElement);
    const instance = monaco.editor.create(host.current, {
      theme: editorTheme(useAppearance.getState(), useSystemDark.getState()),
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
          const text = await desktop.call('python.format', {
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
              void desktop
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
