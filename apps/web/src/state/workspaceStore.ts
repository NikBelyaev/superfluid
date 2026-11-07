import { desktop } from '~/rpc/desktop';
import { create } from 'zustand';
import type {
  Action,
  GitRepository,
  GitStatus,
  Operation,
  Project,
  Run,
  Session,
} from '@superfluid/contracts';
import { emptyView, surfaceKey, type ViewState, type Surface } from './workspaceView';
import type { Modal } from './dialogs';
import { repositorySummary } from './repositories';
import type { GitMenuPage, GitBatch } from '~/commands/gitBatch';

export { surfaceKey, type Surface, type Location, type ViewState } from './workspaceView';

interface State {
  projects: Project[];
  sessions: Session[];
  projectId: string | null;
  sessionId: string | null;
  views: Record<string, ViewState>;
  actions: Action[];
  runs: Run[];
  operations: Operation[];
  git: Record<string, GitStatus>;
  repositories: Record<string, GitRepository[]>;
  repositoryGit: Record<string, Record<string, GitStatus>>;
  repositoryErrors: Record<string, Record<string, string>>;
  gitBatches: Record<string, GitBatch | undefined>;
  repositoryWorktrees: Record<string, { startedAt: number }>;
  repositoryMenu: { sessionId: string; page: GitMenuPage } | null;
  error: string | null;
  busy: string | null;
  modal: Modal;
  palette: 'files' | 'commands' | 'search' | null;
  showSidebar: boolean;
  island: boolean;
  language: Record<string, string>;
  revision: number;
  bootstrap: () => Promise<void>;
  openProject: (p: Project) => Promise<void>;
  switchSession: (id: string) => void;
  setView: (patch: Partial<ViewState>, id?: string) => void;
  openFile: (path: string, line?: number, column?: number, record?: boolean) => Promise<void>;
  refreshGit: (sessionId?: string) => Promise<void>;
  refreshRepositories: (sessionId: string, refresh?: boolean) => Promise<void>;
  refreshRepositoryGit: (sessionId: string, repositoryIds: string[]) => Promise<void>;
  fail: (e: unknown) => void;
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const repositoryReads = new Map<string, symbol>();

export const useApp = create<State>((set, get) => ({
  projects: [],
  sessions: [],
  projectId: null,
  sessionId: null,
  views: {},
  actions: [],
  runs: [],
  operations: [],
  git: {},
  repositories: {},
  repositoryGit: {},
  repositoryErrors: {},
  gitBatches: {},
  repositoryWorktrees: {},
  repositoryMenu: null,
  error: null,
  busy: null,
  modal: null,
  palette: null,
  showSidebar: true,
  island: true,
  language: {},
  revision: 0,
  fail: (e) => set({ error: e instanceof Error ? e.message : String(e) }),
  bootstrap: async () => {
    try {
      const data = await desktop.call('bootstrap', {});
      set(data);
    } catch (e) {
      get().fail(e);
    }
  },
  openProject: async (p) => {
    set({ busy: 'Opening project…' });
    try {
      const sessions = await desktop.call('session.list', { projectId: p.id });
      const views = { ...get().views };
      for (const s of sessions)
        if (!views[s.id]) {
          const saved = s.state as Partial<ViewState>;
          views[s.id] = {
            ...emptyView(),
            ...saved,
            repositoryIds: Array.isArray(saved.repositoryIds)
              ? saved.repositoryIds.filter((id) => typeof id === 'string')
              : undefined,
            editorViews: saved.editorViews ?? {},
            tabs: Array.isArray(saved.tabs)
              ? saved.tabs.filter((x) => typeof x === 'string').slice(0, 80)
              : [],
            history: Array.isArray(saved.history) ? saved.history.slice(-100) : [],
          };
        }
      const runIds = new Set(get().runs.map((r) => r.id));
      for (const s of sessions) {
        const view = views[s.id];
        view.rightTabs = (view.rightTabs ?? []).filter(
          (surface) => surface.kind !== 'terminal' || runIds.has(surface.id),
        );
        if (view.surface?.kind === 'terminal' && !runIds.has(view.surface.id))
          view.surface = view.rightTabs.at(-1) ?? null;
      }
      const selected = sessions.find((s) => s.available)?.id ?? sessions[0]?.id ?? null;
      set({ projectId: p.id, sessions, views, sessionId: selected, busy: null });
      if (selected) get().switchSession(selected);
    } catch (e) {
      set({ busy: null });
      get().fail(e);
    }
  },
  switchSession: (id) => {
    if (!get().sessions.some((s) => s.id === id)) return;
    performance.mark('superfluid:switch-start');
    set({ sessionId: id, modal: null, palette: null, repositoryMenu: null });
    void import('~/state/editor/Documents').then((d) => d.documents.activate(id)).catch(get().fail);
    void get().refreshGit(id);
  },
  setView: (patch, id) => {
    const target = id ?? get().sessionId;
    if (!target) return;
    const state = { ...(get().views[target] ?? emptyView()), ...patch };
    set({ views: { ...get().views, [target]: state } });
    if (patch.repositoryIds && get().repositories[target])
      set({
        git: {
          ...get().git,
          [target]: repositorySummary(
            get().repositories[target],
            get().repositoryGit[target] || {},
            patch.repositoryIds,
          ),
        },
      });
    clearTimeout(persistTimers.get(target));
    persistTimers.set(
      target,
      setTimeout(() => {
        persistTimers.delete(target);
        void desktop
          .call('session.state', {
            sessionId: target,
            state: state as unknown as Record<string, unknown>,
          })
          .catch(get().fail);
      }, 350),
    );
  },
  openFile: async (path, line, column, record = true) => {
    const s = get().sessions.find((s) => s.id === get().sessionId);
    if (!s) return;
    try {
      const { documents } = await import('~/state/editor/Documents');
      const doc = await documents.open(s, path);
      documents.focused = doc;
      const view = get().views[s.id] ?? emptyView();
      const tabs = view.tabs.includes(path) ? view.tabs : [...view.tabs, path];
      let history = view.history,
        index = view.historyIndex;
      if (record && line) {
        history = [
          ...history.slice(0, index + 1),
          { path, line, column: column ?? 1, label: path.split('/').at(-1) || path },
        ].slice(-100);
        index = history.length - 1;
      }
      if (line) doc.reveal = { line, column: column ?? 1 };
      set({ revision: get().revision + 1, palette: null });
      get().setView({ tabs, active: path, history, historyIndex: index }, s.id);
    } catch (e) {
      get().fail(e);
    }
  },
  refreshRepositories: async (id, refresh = false) => {
    const repositories = await desktop.call('git.repositories', { sessionId: id, refresh });
    set({ repositories: { ...get().repositories, [id]: repositories } });
    if (repositories.length === 1) {
      const selected = get().views[id]?.repositoryIds;
      if (selected?.length !== 1 || selected[0] !== repositories[0].id)
        get().setView({ repositoryIds: [repositories[0].id] }, id);
    } else if (!get().views[id]?.repositoryIds) {
      const active = get().views[id]?.active;
      const initial =
        repositories
          .filter((r) => r.path && active?.startsWith(r.path + '/'))
          .sort((a, b) => b.path.length - a.path.length)[0] ||
        repositories.find((r) => r.path) ||
        repositories[0];
      get().setView({ repositoryIds: initial ? [initial.id] : [] }, id);
    } else {
      const before = get().views[id].repositoryIds!;
      const available = before.filter((repositoryId) =>
        repositories.some((r) => r.id === repositoryId),
      );
      if (available.length !== before.length) get().setView({ repositoryIds: available }, id);
    }
    await get().refreshGit(id);
  },
  refreshRepositoryGit: async (id, repositoryIds) => {
    const values: Record<string, GitStatus> = {};
    const errors: Record<string, string | undefined> = {};
    const versions = new Map<string, symbol>();
    for (const repositoryId of repositoryIds) {
      const version = Symbol();
      versions.set(repositoryId, version);
      repositoryReads.set(`${id}:${repositoryId}`, version);
      try {
        values[repositoryId] = await desktop.call('git.status', { sessionId: id, repositoryId });
        errors[repositoryId] = undefined;
      } catch (error) {
        errors[repositoryId] = error instanceof Error ? error.message : String(error);
      }
    }
    for (const repositoryId of Object.keys(errors))
      if (repositoryReads.get(`${id}:${repositoryId}`) !== versions.get(repositoryId)) {
        delete values[repositoryId];
        delete errors[repositoryId];
      }
    const repositoryErrors = { ...get().repositoryErrors[id] };
    for (const [repositoryId, error] of Object.entries(errors)) {
      if (error) repositoryErrors[repositoryId] = error;
      else delete repositoryErrors[repositoryId];
    }
    const statuses = { ...get().repositoryGit[id], ...values };
    const repositories = (get().repositories[id] || []).map((r) => ({
      ...r,
      branch: statuses[r.id]?.branch || r.branch,
    }));
    const root = repositories.find((r) => !r.path);
    const rootStatus = root && values[root.id];
    set({
      repositoryGit: { ...get().repositoryGit, [id]: statuses },
      repositoryErrors: { ...get().repositoryErrors, [id]: repositoryErrors },
      repositories: { ...get().repositories, [id]: repositories },
      git: {
        ...get().git,
        [id]: repositorySummary(repositories, statuses, get().views[id]?.repositoryIds || []),
      },
      ...(rootStatus
        ? {
            sessions: get().sessions.map((s) =>
              s.id === id
                ? {
                    ...s,
                    branch: s.repositoryWorktree ? s.branch : rootStatus.branch,
                    head: rootStatus.head,
                  }
                : s,
            ),
          }
        : {}),
    });
  },
  refreshGit: async (sessionId) => {
    const id = sessionId ?? get().sessionId;
    if (!id) return;
    try {
      if (!get().repositories[id]) return await get().refreshRepositories(id);
      await get().refreshRepositoryGit(id, get().views[id]?.repositoryIds || []);
    } catch (e) {
      get().fail(e);
    }
  },
}));

export async function flushLayouts() {
  const state = useApp.getState();
  for (const t of persistTimers.values()) clearTimeout(t);
  persistTimers.clear();
  for (const [sessionId, view] of Object.entries(state.views)) {
    await desktop.call('session.state', {
      sessionId,
      state: view as unknown as Record<string, unknown>,
    });
  }
}

export const currentSession = () => {
  const a = useApp.getState();
  return a.sessions.find((s) => s.id === a.sessionId);
};

export function showSurface(surface: Surface, sessionId?: string) {
  const a = useApp.getState(),
    target = sessionId ?? a.sessionId,
    view = target ? a.views[target] : null;
  if (!view) return;
  if (a.repositoryMenu?.sessionId === target) useApp.setState({ repositoryMenu: null });
  if (surface.kind === 'pr' && !surface.repositoryId) {
    const repository = (a.repositories[target!] || [])
      .filter((r) => r.path && view.active?.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    surface = { ...surface, repositoryId: repository?.id || view.repositoryIds?.[0] };
  }
  const tabs = view.rightTabs ?? [];
  a.setView(
    {
      surface,
      rightTabs: tabs.some((s) => surfaceKey(s) === surfaceKey(surface))
        ? tabs
        : [...tabs, surface],
      ...(surface.kind === 'diff' ? { changes: true } : {}),
    },
    target!,
  );
}
