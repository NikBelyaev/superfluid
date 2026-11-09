import { runAction } from '~/commands/runProjectAction';
import { useEffect } from 'react';
import { useApp, currentSession, openPalette } from '~/state/workspaceStore';
import { keySignature } from '~/shortcuts/keySignature';
import { activeFile } from '~/state/workspaceView';

export function useAppShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.metaKey && e.code === 'Comma') {
        e.preventDefault();
        useApp.setState({ modal: { kind: 'settings' }, palette: null });
        return;
      }
      if (useApp.getState().modal?.kind === 'settings') return;
      if (!useApp.getState().projectId) {
        if (e.metaKey && e.code === 'KeyP') {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('.project-search input')?.focus();
        }
        return;
      }
      if (e.metaKey && e.code === 'KeyP') {
        e.preventDefault();
        openPalette(e.shiftKey ? 'commands' : 'files');
        return;
      }
      if (e.metaKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        openPalette('search');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyT') {
        e.preventDefault();
        openPalette('symbols');
        return;
      }
      if (e.metaKey && e.code === 'KeyS') {
        e.preventDefault();
        void import('~/state/editor/Documents').then(({ documents }) => {
          const s = currentSession(),
            v = s ? useApp.getState().views[s.id] : null;
          const focused = documents.focused;
          const doc =
            focused?.session.id === s?.id && !focused?.model.isDisposed()
              ? focused
              : s && v && activeFile(v)
                ? documents.items.get(documents.key(s.id, activeFile(v)!))
                : null;
          if (doc) void documents.save(doc).catch(useApp.getState().fail);
        });
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.code === 'Tab') {
        e.preventDefault();
        const a = useApp.getState(),
          i = a.sessions.findIndex((s) => s.id === a.sessionId);
        a.switchSession(
          a.sessions[(i + (e.shiftKey ? -1 : 1) + a.sessions.length) % a.sessions.length]?.id,
        );
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.code === 'Minus') {
        e.preventDefault();
        const s = currentSession();
        if (!s) return;
        const a = useApp.getState(),
          v = a.views[s.id],
          index = v.historyIndex + (e.shiftKey ? 1 : -1),
          item = v.history[index];
        if (item) {
          a.setView({ historyIndex: index });
          void a.openFile(
            item.path,
            item.line,
            item.column,
            false,
            item.group,
            item.tab ? { tabKey: item.tab } : undefined,
          );
        }
        return;
      }
      const s = currentSession();
      if (s) {
        const action = useApp
          .getState()
          .actions.find(
            (a) => a.projectId === s.projectId && a.shortcut && a.shortcut === keySignature(e),
          );
        if (action) {
          e.preventDefault();
          void runAction(s, action);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
