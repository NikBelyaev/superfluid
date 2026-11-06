import { runAction } from '~/commands/runProjectAction';
import { useEffect } from 'react';
import { useApp, currentSession } from '~/state/workspaceStore';
import { keySignature } from '~/shortcuts/keySignature';

export function useAppShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!useApp.getState().projectId) {
        if (e.metaKey && e.code === 'KeyP') {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('.project-search input')?.focus();
        }
        return;
      }
      if (e.metaKey && e.code === 'KeyP') {
        e.preventDefault();
        useApp.setState({ palette: e.shiftKey ? 'commands' : 'files' });
        return;
      }
      if (e.metaKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        useApp.setState({ palette: 'search' });
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
              : s && v?.active
                ? documents.items.get(documents.key(s.id, v.active))
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
          void a.openFile(item.path, item.line, item.column, false);
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
