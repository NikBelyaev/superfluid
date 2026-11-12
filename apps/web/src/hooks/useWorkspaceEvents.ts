import { desktop } from '~/rpc/desktop';
import { useEffect } from 'react';
import { useApp } from '~/state/workspaceStore';

export function useWorkspaceEvents() {
  useEffect(() => {
    void useApp.getState().bootstrap();
    return desktop.onEvent((e) => {
      if (e.type === 't3') useApp.setState({ t3: e.integration, t3Agents: e.agents });
      else if (e.type === 't3.agent')
        useApp.setState((app) => ({
          t3Agents: [...app.t3Agents.filter((agent) => agent.id !== e.agent.id), e.agent].slice(
            -128,
          ),
        }));
      else if (e.type === 'codex') useApp.setState({ codex: e.integration, codexAgents: e.agents });
      else if (e.type === 'codex.agent')
        useApp.setState((app) => ({
          codexAgents: [
            ...app.codexAgents.filter((agent) => agent.id !== e.agent.id),
            e.agent,
          ].slice(-128),
        }));
      else if (e.type === 'runs') useApp.setState({ runs: e.runs });
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
      else if (e.type === 'files.changed') {
        void import('~/state/editor/Documents')
          .then(({ documents }) => documents.refreshSession(e.sessionId))
          .catch(useApp.getState().fail);
        if (e.sessionId === useApp.getState().sessionId)
          void useApp.getState().refreshGit(e.sessionId);
      }
    });
  }, []);
  useEffect(() => {
    const save = () => {
      if (!useApp.getState().sessions.length) return;
      void import('~/state/editor/Documents')
        .then(({ documents }) => documents.saveAll())
        .catch(useApp.getState().fail);
    };
    const hide = () => {
      if (document.hidden) save();
    };
    window.addEventListener('blur', save);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('blur', save);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(
    () =>
      desktop.onFlush(async () => {
        const { documents } = await import('~/state/editor/Documents');
        documents.captureViews();
        await Promise.all([
          documents.saveAll(),
          import('~/state/workspaceStore').then((s) => s.flushLayouts()),
        ]);
      }),
    [],
  );
}
