import { desktop } from '~/rpc/desktop';
import { useEffect } from 'react';
import { useApp } from '~/state/workspaceStore';

export function useWorkspaceEvents() {
  useEffect(() => {
    void useApp.getState().bootstrap();
    return desktop.onEvent((e) => {
      if (e.type === 'runs') useApp.setState({ runs: e.runs });
      else if (e.type === 'project')
        useApp.setState((app) => ({
          projects: app.projects.map((project) =>
            project.id === e.project.id ? e.project : project,
          ),
        }));
      else if (e.type === 'operation')
        useApp.setState((a) => ({
          operations: [...a.operations.filter((o) => o.id !== e.operation.id), e.operation],
        }));
      else if (e.type === 'error') useApp.getState().fail(new Error(e.message));
      else if (e.type === 'lsp.status')
        useApp.setState((a) => ({ language: { ...a.language, [e.sessionId]: e.status } }));
      else if (e.type === 'files.changed' && e.sessionId === useApp.getState().sessionId)
        void useApp.getState().refreshGit(e.sessionId);
    });
  }, []);
  useEffect(
    () =>
      desktop.onFlush(async () => {
        const { documents } = await import('~/state/editor/Documents');
        documents.captureViews();
        await Promise.all([
          documents.recovery.flushAll(),
          import('~/state/workspaceStore').then((s) => s.flushLayouts()),
        ]);
      }),
    [],
  );
}
