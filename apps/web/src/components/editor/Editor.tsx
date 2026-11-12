import { desktop } from '~/rpc/desktop';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle } from 'lucide-react';
import { documents, monaco, subscribe, getRevision, type Doc } from '~/state/editor/Documents';
import { showSurface, useApp } from '~/state/workspaceStore';
import { useFileDiff } from '~/components/diffs/useFileDiff';
import { installGitDecorations } from './gitDecorations';
import { editorTheme, useAppearance, useSystemDark } from '~/state/appearance';
import type { Session } from '@superfluid/contracts';
import './theme';
import '~/components/python/languageProviders';
import { navigate } from '~/components/python/navigation';
import { installDefinitionHover } from '~/components/python/definitionPreview';
import { installDefinitionLinks } from '~/components/python/definitionLinks';
import { installSymbolActions, renameSymbol } from '~/components/python/symbolActions';
import {
  editorViewKey,
  setTabGroup,
  surfaceKey,
  tabGroup,
  type TabGroup,
} from '~/state/workspaceView';

export default function Editor({
  session,
  path,
  tabKey,
  group = 'main',
}: {
  session: Session;
  path: string | null;
  tabKey: string;
  group?: TabGroup;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    bound = useRef<Doc | null>(null),
    boundTab = useRef<string | null>(null);
  const capture = useRef<() => void>(() => {});
  const [doc, setDoc] = useState<Doc | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const revision = useApp((a) => a.revision);
  const diff = useFileDiff(session, doc?.path === path && !doc.readOnly ? path : undefined);
  useEffect(() => {
    const instance = editor.current;
    const file = diff?.files?.[0];
    if (
      !instance ||
      !doc ||
      !file ||
      diff.version === undefined ||
      instance.getModel() !== doc.model
    )
      return;
    return installGitDecorations(instance, file, diff.version, () =>
      showSurface({ kind: 'diff', path: doc.path }, doc.session.id),
    );
  }, [doc, diff?.files, diff?.version]);
  const theme = editorTheme(useAppearance(), useSystemDark());
  useEffect(() => monaco.editor.setTheme(theme), [theme]);
  useSyncExternalStore(subscribe, getRevision);
  useLayoutEffect(() => {
    if (!host.current) return;
    const appearance = getComputedStyle(document.documentElement);
    const instance = monaco.editor.create(host.current, {
      theme: editorTheme(useAppearance.getState(), useSystemDark.getState()),
      model: null,
      fontFamily: appearance.getPropertyValue('--font-mono').trim(),
      fontSize: parseFloat(appearance.getPropertyValue('--font-size-editor')),
      lineHeight: 22,
      minimap: { enabled: false },
      padding: { top: 0, bottom: 20 },
      scrollbar: { useShadows: false },
      scrollBeyondLastLine: false,
      smoothScrolling: false,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      useShadowDOM: false,
      renderLineHighlight: 'line',
      overviewRulerBorder: false,
      roundedSelection: false,
      tabSize: 4,
      wordWrap: 'off',
      guides: { indentation: true },
      bracketPairColorization: { enabled: true },
    });
    editor.current = instance;
    const removeHoverNavigation = installDefinitionHover(host.current);
    const removeDefinitionLinks = installDefinitionLinks(instance);
    const removeSymbolActions = installSymbolActions(instance, host.current);
    const remember = () => {
      const d = bound.current;
      if (!d || d.model.isDisposed()) return;
      const saved = instance.saveViewState();
      if (!saved) return;
      const view = useApp.getState().views[d.session.id];
      if (!view) return;
      const key = editorViewKey(group, d.path);
      const persisted = {
        ...saved,
        cursorState: saved.cursorState.slice(0, 16),
        contributionsState: {},
      };
      const current = tabGroup(view, group);
      const tab = current.tabs.find((tab) => surfaceKey(tab) === boundTab.current);
      const position = saved.cursorState[0]?.position;
      let next = view;
      if (
        tab?.kind === 'file' &&
        tab.path === d.path &&
        tab.chain &&
        position &&
        !(d.reveal && (d.reveal.group ?? 'main') === group)
      ) {
        const entry = tab.chain.entries[tab.chain.index]!;
        if (entry.line !== position.lineNumber || entry.column !== position.column) {
          const updated = {
            ...tab,
            chain: {
              ...tab.chain,
              entries: tab.chain.entries.map((item, index) =>
                index === tab.chain!.index
                  ? { ...item, line: position.lineNumber, column: position.column }
                  : item,
              ),
            },
          };
          next = setTabGroup(
            view,
            group,
            current.tabs.map((item) => (item === tab ? updated : item)),
            current.active && surfaceKey(current.active) === surfaceKey(tab)
              ? updated
              : current.active,
          );
          next.rightPanelOpen = view.rightPanelOpen;
        }
      }
      if (next === view && JSON.stringify(view.editorViews?.[key]) === JSON.stringify(persisted))
        return;
      useApp.getState().setView(
        {
          ...next,
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
    const openDiff = instance.addAction({
      id: 'superfluid.diff',
      label: 'Open file diff (Index → Buffer)',
      contextMenuGroupId: 'navigation',
      run: () => {
        const d = bound.current;
        if (d && !d.readOnly) showSurface({ kind: 'diff', path: d.path }, d.session.id);
      },
    });
    const rename = instance.addAction({
      id: 'superfluid.rename',
      label: 'Rename symbol…',
      keybindings: [monaco.KeyCode.F2],
      run: () => {
        const d = bound.current,
          p = instance.getPosition();
        if (d && p && !d.readOnly) renameSymbol(instance, d, p);
      },
    });
    const format = instance.addAction({
      id: 'superfluid.format',
      label: 'Format Python with Ruff',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: async () => {
        const d = bound.current;
        if (!d || d.readOnly) return;
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
              group,
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
      documents.focusedGroup = group;
    });
    const blur = instance.onDidBlurEditorWidget(() => {
      const d = bound.current;
      if (d?.dirty) void documents.save(d).catch(useApp.getState().fail);
    });
    return () => {
      remember();
      unregister();
      capture.current = () => {};
      save.dispose();
      openDiff.dispose();
      rename.dispose();
      format.dispose();
      opener.dispose();
      removeHoverNavigation();
      removeDefinitionLinks();
      removeSymbolActions();
      focus.dispose();
      blur.dispose();
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
      boundTab.current = null;
      setDoc(null);
      return;
    }
    setError('');
    const bind = (d: Doc) => {
      if (cancelled || !editor.current) return;
      const ownerChanged = boundTab.current !== tabKey;
      bound.current = d;
      boundTab.current = tabKey;
      setDoc(d);
      const changed = editor.current.getModel() !== d.model;
      if (changed) editor.current.setModel(d.model);
      editor.current.updateOptions({
        readOnly: !!d.readOnly,
        domReadOnly: !!d.readOnly,
        ariaLabel: d.readOnly ? 'Read-only editor content' : 'Editor content',
      });
      const saved = useApp.getState().views[session.id]?.editorViews?.[editorViewKey(group, path)];
      if (saved) editor.current.restoreViewState(saved);
      let revealed = false;
      if (d.reveal && (d.reveal.group ?? 'main') === group) {
        editor.current.setPosition({ lineNumber: d.reveal.line, column: d.reveal.column });
        editor.current.revealLineInCenterIfOutsideViewport(d.reveal.line);
        d.reveal = undefined;
        revealed = true;
      }
      // Finish the new view before React allows the next paint.
      if (changed) {
        const visible = editor.current.getVisibleRanges()[0];
        if (d.model.getLanguageId() === 'python' && visible?.startLineNumber === 1) {
          // Prime one screen; tokenizing up to a deep saved position can block the UI.
          const lines = Math.max(
            1,
            Math.ceil(
              editor.current.getLayoutInfo().height /
                editor.current.getOption(monaco.editor.EditorOption.lineHeight),
            ),
          );
          monaco.editor.colorizeModelLine(d.model, Math.min(visible.endLineNumber, lines));
        }
        editor.current.render();
      }
      const active = document.activeElement;
      const editingElsewhere =
        active instanceof HTMLElement &&
        active.matches('input, textarea, [contenteditable="true"]') &&
        !host.current?.contains(active);
      if (
        (changed || revealed || ownerChanged) &&
        !editingElsewhere &&
        !useApp.getState().palette &&
        !useApp.getState().modal
      ) {
        editor.current.focus();
        documents.focused = d;
        documents.focusedGroup = group;
      }
      setLoading(false);
      performance.mark('superfluid:editor-bound');
    };
    const cached = documents.items.get(documents.key(session.id, path));
    if (!cached) {
      setLoading(true);
      editor.current?.setModel(null);
      bound.current = null;
      setDoc(null);
    }
    const opening = documents.open(session, path);
    if (cached) bind(cached);
    void opening
      .then((d) => {
        if (!cached) bind(d);
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
  }, [session.id, path, revision, tabKey]);
  return (
    <div
      className="editor-pane"
      onPointerDownCapture={() => {
        documents.focused = bound.current;
        documents.focusedGroup = group;
      }}
    >
      {doc?.readOnly && (
        <div className="editor-notice">
          <span className="definition-readonly">
            {doc.path.endsWith('.pyi') ? 'Type stub · Read only' : 'Read only'}
          </span>
        </div>
      )}
      {doc?.recovered && (
        <div className="recovery-banner">
          <AlertCircle size={14} />
          {doc.diskText === undefined
            ? 'Recovered unsaved changes. The disk version is unavailable.'
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
