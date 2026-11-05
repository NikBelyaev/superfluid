import { create } from 'zustand';
import type { editor } from 'monaco-editor/editor/editor.api';
import type {
  Action,
  GitStatus,
  Operation,
  Project,
  Run,
  Session,
} from '../../../packages/contracts';

export type Surface =
  | { kind: 'terminal'; id: string }
  | { kind: 'diff'; path?: string; mode?: 'unstaged' | 'staged' | 'branch' }
  | { kind: 'pr'; number?: number }
  | { kind: 'browser'; url: string }
  | { kind: 'file'; path: string };
export interface Location {
  path: string;
  line: number;
  column: number;
  label: string;
}
export interface ViewState {
  tabs: string[];
  active: string | null;
  expanded: string[];
  changes: boolean;
  surface: Surface | null;
  rightTabs: Surface[];
  history: Location[];
  historyIndex: number;
  editorViews: Record<string, editor.ICodeEditorViewState>;
}
const emptyView = (): ViewState => ({
  tabs: [],
  active: null,
  expanded: [],
  changes: false,
  surface: null,
  rightTabs: [],
  history: [],
  historyIndex: -1,
  editorViews: {},
});
type Modal =
  | { kind: 'action'; action?: Action }
  | { kind: 'worktree' }
  | { kind: 'git'; action: 'commit' | 'push' | 'pr' | 'publish' }
  | { kind: 'git-review'; id: string }
  | { kind: 'terminal-name'; id: string; name: string }
  | { kind: 'clone' }
  | { kind: 'new-file'; directory: boolean; parent: string }
  | { kind: 'rename'; path: string }
  | { kind: 'interpreter' }
  | { kind: 'launcher' }
  | { kind: 'rename-symbol'; edit?: any; source?: { path: string; line: number; column: number } }
  | null;
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
  fail: (e: unknown) => void;
}
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
      const data = await window.superfluid.call('bootstrap', {});
      set(data);
    } catch (e) {
      get().fail(e);
    }
  },
  openProject: async (p) => {
    set({ busy: 'Opening project…' });
    try {
      const sessions = await window.superfluid.call('session.list', { projectId: p.id });
      const views = { ...get().views };
      for (const s of sessions)
        if (!views[s.id]) {
          const saved = s.state as Partial<ViewState>;
          views[s.id] = {
            ...emptyView(),
            ...saved,
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
    set({ sessionId: id, modal: null, palette: null });
    void import('./documents').then((d) => d.documents.activate(id)).catch(get().fail);
    void get().refreshGit(id);
  },
  setView: (patch, id) => {
    const target = id ?? get().sessionId;
    if (!target) return;
    const state = { ...(get().views[target] ?? emptyView()), ...patch };
    set({ views: { ...get().views, [target]: state } });
    clearTimeout(persistTimers.get(target));
    persistTimers.set(
      target,
      setTimeout(() => {
        persistTimers.delete(target);
        void window.superfluid
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
      const { documents } = await import('./documents');
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
  refreshGit: async (sessionId) => {
    const id = sessionId ?? get().sessionId;
    if (!id) return;
    try {
      const status = await window.superfluid.call('git.status', { sessionId: id });
      const before = get().sessions.find((s) => s.id === id);
      set({
        git: { ...get().git, [id]: status },
        sessions: get().sessions.map((s) =>
          s.id === id && status.repo ? { ...s, branch: status.branch, head: status.head } : s,
        ),
      });
      if (before?.branch && status.repo && before.branch !== status.branch)
        get().fail(
          new Error(
            'The branch changed outside Superfluid. Buffers were kept; check the new branch and disk version before saving.',
          ),
        );
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
    await window.superfluid.call('session.state', {
      sessionId,
      state: view as unknown as Record<string, unknown>,
    });
  }
}
export const currentSession = () => {
  const a = useApp.getState();
  return a.sessions.find((s) => s.id === a.sessionId);
};
export const surfaceKey = (s: Surface) =>
  s.kind === 'terminal'
    ? `terminal:${s.id}`
    : s.kind === 'file'
      ? `file:${s.path}`
      : s.kind === 'diff'
        ? `diff:${s.path ?? ''}`
        : s.kind === 'pr'
          ? `pr:${s.number ?? ''}`
          : `browser:${s.url}`;
export function showSurface(surface: Surface, sessionId?: string) {
  const a = useApp.getState(),
    target = sessionId ?? a.sessionId,
    view = target ? a.views[target] : null;
  if (!view) return;
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
