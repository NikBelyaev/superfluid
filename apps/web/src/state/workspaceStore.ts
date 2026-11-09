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
import {
  emptyView,
  surfaceKey,
  restoreView,
  activeFile,
  tabGroup,
  setTabGroup,
  editorViewKey,
  rightPanelVisible,
  type TabGroup,
  type ViewState,
  type Surface,
  type Location,
} from './workspaceView';
import type { Modal } from './dialogs';
import { repositorySummary } from './repositories';
import type { GitMenuPage, GitBatch } from '~/commands/gitBatch';
import { sameSymbol, symbolAt, type DocumentSymbol } from '~/components/python/symbols';
import { recordLocation } from '~/components/editor/lineage';
import { followFile, selectFileLocation, surfacePaths } from './fileChains';

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
  palette: 'files' | 'commands' | 'search' | 'symbols' | null;
  paletteQuery?: string;
  surfaceMenu: { sessionId: string; group: TabGroup; tabKey?: string; kind?: 'chain' } | null;
  island: boolean;
  language: Record<string, string>;
  revision: number;
  bootstrap: () => Promise<void>;
  openProject: (p: Project) => Promise<void>;
  closeProject: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  setView: (patch: Partial<ViewState>, id?: string) => void;
  openFile: (
    path: string,
    line?: number,
    column?: number,
    record?: boolean,
    group?: TabGroup,
    navigation?: { tabKey: string; origin?: Location },
  ) => Promise<void>;
  refreshGit: (sessionId?: string) => Promise<void>;
  refreshRepositories: (sessionId: string, refresh?: boolean) => Promise<void>;
  refreshRepositoryGit: (sessionId: string, repositoryIds: string[]) => Promise<void>;
  fail: (e: unknown) => void;
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const repositoryReads = new Map<string, symbol>();
let contextChange = 0;

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
  surfaceMenu: null,
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
    const change = ++contextChange;
    set({ busy: 'Opening project…' });
    try {
      if (get().projectId) {
        const { documents } = await import('~/state/editor/Documents');
        await documents.saveAll();
      }
      const sessions = await desktop.call('session.list', { projectId: p.id });
      if (change !== contextChange) return;
      const views = { ...get().views };
      const runIds = new Set(get().runs.map((r) => r.id));
      for (const s of sessions) views[s.id] = restoreView(views[s.id] ?? s.state, runIds);
      const selected = sessions.find((s) => s.available)?.id ?? sessions[0]?.id ?? null;
      set({ projectId: p.id, sessions, views, sessionId: selected, busy: null });
      if (selected) await get().switchSession(selected);
    } catch (e) {
      if (change !== contextChange) return;
      set({ busy: null });
      get().fail(e);
    }
  },
  closeProject: async () => {
    const change = ++contextChange;
    try {
      const { documents } = await import('~/state/editor/Documents');
      await documents.saveAll();
      if (change === contextChange) set({ projectId: null, busy: null });
    } catch (error) {
      if (change === contextChange) get().fail(error);
    }
  },
  switchSession: async (id) => {
    if (!get().sessions.some((s) => s.id === id)) return;
    performance.mark('superfluid:switch-start');
    const change = ++contextChange;
    const previous = get().sessionId;
    try {
      if (previous && previous !== id) {
        const { documents } = await import('~/state/editor/Documents');
        await documents.saveSession(previous, ['']);
      }
      if (change !== contextChange) return;
      set({
        sessionId: id,
        modal: null,
        palette: null,
        surfaceMenu: null,
        repositoryMenu: null,
        busy: null,
      });
      void import('~/state/editor/Documents')
        .then((d) => d.documents.activate(id))
        .catch(get().fail);
      void get().refreshGit(id);
    } catch (error) {
      if (change === contextChange) get().fail(error);
    }
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
  openFile: async (path, line, column, record = true, group = 'main', navigation) => {
    const s = get().sessions.find((s) => s.id === get().sessionId);
    if (!s) return;
    try {
      const { documents, documentPath } = await import('~/state/editor/Documents');
      const doc = await documents.open(s, path);
      let symbols: DocumentSymbol[] = [];
      const candidate = tabGroup(get().views[s.id], group).active;
      if (
        record &&
        line !== undefined &&
        candidate?.kind === 'file' &&
        candidate.path === path &&
        (navigation ? surfaceKey(candidate) === navigation.tabKey : !candidate.chain)
      ) {
        const version = doc.version;
        symbols = await documents.outline(doc).catch(() => []);
        if (doc.version !== version) symbols = [];
      }
      documents.captureViews();
      const view = get().views[s.id] ?? emptyView();
      const current = tabGroup(view, group);
      const source = navigation
        ? current.tabs.find((tab) => surfaceKey(tab) === navigation.tabKey)
        : undefined;
      if (navigation?.origin && (source?.kind !== 'file' || source.path !== navigation.origin.path))
        return;
      const locationAt = (path: string): Location => {
        const position = view.editorViews[editorViewKey(group, path)]?.cursorState[0]?.position;
        return {
          path,
          line: position?.lineNumber ?? 1,
          column: position?.column ?? 1,
          label: documentPath(path).split('/').at(-1) || path,
          ...(group === 'main' ? {} : { group }),
        };
      };
      const destination = locationAt(path);
      if (line !== undefined) {
        destination.line = line;
        destination.column = column ?? 1;
      } else if (source?.kind === 'file' && source.chain && source.path === path) {
        const entry = source.chain.entries[source.chain.index]!;
        destination.line = entry.line;
        destination.column = entry.column;
      }
      const origin = current.active;
      const unchanged = !!(
        record &&
        origin?.kind === 'file' &&
        (navigation?.origin ||
          surfaceKey(origin) === (source ? surfaceKey(source) : `file:${path}`)) &&
        (sameSymbol(symbols, navigation?.origin ?? locationAt(origin.path), destination) ||
          sameSymbol(symbols, locationAt(origin.path), destination))
      );
      if (unchanged) record = false;
      let next = view;
      let focus = get().sessionId === s.id;
      let history = view.history;
      if (source?.kind === 'file') {
        const file = navigation?.origin
          ? unchanged
            ? source
            : followFile(source, navigation.origin, destination)
          : selectFileLocation(source, destination);
        const key = surfaceKey(file);
        if (file.chain) destination.tab = key;
        const selected = current.active && surfaceKey(current.active) === surfaceKey(source);
        next = setTabGroup(
          view,
          group,
          current.tabs.map((tab) => (tab === source ? file : tab)),
          !navigation?.origin || selected ? file : current.active,
        );
        if (group === 'right' && navigation?.origin) next.rightPanelOpen = rightPanelVisible(view);
        focus &&=
          !navigation?.origin || (!!selected && (group !== 'right' || rightPanelVisible(view)));
        if (!source.chain && file.chain)
          history = history.map((item) =>
            item.path === source.path && !item.tab && (item.group ?? 'main') === group
              ? { ...item, tab: key }
              : item,
          );
      }
      let trail = { history, historyIndex: view.historyIndex };
      if (record && focus && navigation?.origin) {
        trail = recordLocation(trail.history, trail.historyIndex, {
          ...navigation.origin,
          group,
          tab: destination.tab,
        });
        trail = recordLocation(trail.history, trail.historyIndex, destination);
      } else if (
        record &&
        focus &&
        (origin?.kind !== 'file' ||
          origin.path !== path ||
          line !== undefined ||
          (origin.chain ? surfaceKey(origin) : undefined) !== destination.tab)
      ) {
        if (origin?.kind === 'file' && (line === undefined || navigation))
          trail = recordLocation(trail.history, trail.historyIndex, {
            ...locationAt(origin.path),
            ...(origin.chain ? { tab: surfaceKey(origin) } : {}),
          });
        trail = recordLocation(trail.history, trail.historyIndex, destination);
      }
      if (focus) {
        doc.reveal = { line: destination.line, column: destination.column, group };
        documents.focused = doc;
        documents.focusedGroup = group;
        set({ revision: get().revision + 1, palette: null });
      }
      get().setView({ ...next, ...trail }, s.id);
      if (source?.kind !== 'file') showSurface({ kind: 'file', path }, s.id, group);
      const location = trail.history[trail.historyIndex];
      if (record && location?.path === path && location.symbolKind === undefined)
        void resolveLocationSymbol(s.id, location);
      if (navigation?.origin && navigation.origin.path !== path)
        void resolveLocationSymbol(s.id, navigation.origin);
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
      const active = activeFile(get().views[id]);
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
      branch: values[r.id]?.branch || r.branch,
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

export async function resolveLocationSymbol(sessionId: string, location: Location) {
  try {
    const { documents } = await import('~/state/editor/Documents');
    const doc = documents.items.get(documents.key(sessionId, location.path));
    if (!doc || doc.model.getLanguageId() !== 'python') return;
    const version = doc.version;
    const symbols = await documents.outline(doc);
    const app = useApp.getState(),
      view = app.views[sessionId];
    if (doc.version !== version || !view) return;
    const annotate = (item: Location): Location => {
      if (item.path !== location.path) return item;
      const symbol = symbolAt(symbols ?? [], item.line - 1, item.column - 1);
      return symbol && (item.symbol !== symbol.name || item.symbolKind !== symbol.kind)
        ? { ...item, symbol: symbol.name, symbolKind: symbol.kind }
        : item;
    };
    let next = { ...view, history: view.history.map(annotate) };
    for (const group of ['main', 'right', 'bottom'] as const) {
      const { tabs, active } = tabGroup(next, group);
      const updated = tabs.map((tab) =>
        tab.kind === 'file' && tab.chain
          ? { ...tab, chain: { ...tab.chain, entries: tab.chain.entries.map(annotate) } }
          : tab,
      );
      next = setTabGroup(
        next,
        group,
        updated,
        active ? (updated.find((tab) => surfaceKey(tab) === surfaceKey(active)) ?? null) : null,
      );
    }
    next.rightPanelOpen = view.rightPanelOpen;
    app.setView(next, sessionId);
  } catch {
    // Symbol metadata is optional; the recorded file position remains usable.
  }
}

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

export async function closeTabs(sessionId: string, group: TabGroup, keys: string[]) {
  const closed = new Set<string>();
  const closedFiles = new Set<string>();
  try {
    const { documents } = await import('~/state/editor/Documents');
    documents.captureViews();
    for (const key of keys) {
      const view = useApp.getState().views[sessionId];
      if (!view) break;
      const tab = tabGroup(view, group).tabs.find((item) => surfaceKey(item) === key);
      if (!tab) continue;
      const retained = new Set(
        (['main', 'right', 'bottom'] as const).flatMap((other) =>
          tabGroup(view, other)
            .tabs.filter((item) => other !== group || !keys.includes(surfaceKey(item)))
            .flatMap(surfacePaths),
        ),
      );
      for (const path of surfacePaths(tab)) {
        if (!retained.has(path) && !closedFiles.has(path)) {
          await documents.close(sessionId, path);
          closedFiles.add(path);
        }
      }
      closed.add(key);
    }
  } catch (error) {
    useApp.getState().fail(error);
  } finally {
    const app = useApp.getState(),
      view = app.views[sessionId];
    if (view && closed.size) {
      const { tabs, active } = tabGroup(view, group);
      const remaining = tabs.filter((tab) => !closed.has(surfaceKey(tab)));
      const selected =
        active && !closed.has(surfaceKey(active)) ? active : (remaining.at(-1) ?? null);
      app.setView(setTabGroup(view, group, remaining, selected), sessionId);
    }
  }
}

export const currentSession = () => {
  const a = useApp.getState();
  return a.sessions.find((s) => s.id === a.sessionId);
};

export function openPalette(palette: NonNullable<State['palette']>, query = '') {
  useApp.setState({ palette, paletteQuery: query });
}

export function showSurface(
  surface: Surface,
  sessionId?: string,
  group: TabGroup = surface.kind === 'terminal' ? 'bottom' : 'right',
) {
  const a = useApp.getState(),
    target = sessionId ?? a.sessionId,
    view = target ? a.views[target] : null;
  if (!view) return;
  if (a.repositoryMenu?.sessionId === target) useApp.setState({ repositoryMenu: null });
  if (surface.kind === 'pr' && !surface.repositoryId) {
    const repository = (a.repositories[target!] || [])
      .filter((r) => r.path && activeFile(view)?.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    surface = { ...surface, repositoryId: repository?.id || view.repositoryIds?.[0] };
  }
  const { tabs } = tabGroup(view, group);
  a.setView(
    {
      ...setTabGroup(
        view,
        group,
        tabs.some((s) => surfaceKey(s) === surfaceKey(surface)) ? tabs : [...tabs, surface],
        surface,
      ),
      ...(surface.kind === 'files' ? { changes: false } : {}),
    },
    target!,
  );
}
