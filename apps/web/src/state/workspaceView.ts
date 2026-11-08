import type { editor } from 'monaco-editor/editor/editor.api';
import { z } from 'zod';
import { pullRequestRefSchema, type Input } from '@superfluid/contracts';
import { fileTabKey, surfacePaths, mapSurfaceFiles, restoreFileSurface } from './fileChains';

export const surfaceSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('files') }),
    z.object({ kind: z.literal('terminal'), id: z.string() }),
    z.object({
      kind: z.literal('diff'),
      path: z.string().optional(),
      mode: z.enum(['unstaged', 'staged', 'branch']).optional(),
    }),
    z.object({
      kind: z.literal('pr'),
      number: z.number().int().positive().optional(),
      ref: pullRequestRefSchema.optional(),
      repositoryId: z.string().optional(),
      revealChecks: z.string().optional(),
    }),
    z.object({ kind: z.literal('browser'), url: z.string() }),
    z.object({ kind: z.literal('file'), path: z.string(), chain: z.unknown().optional() }),
  ])
  .transform((surface) => (surface.kind === 'file' ? restoreFileSurface(surface) : surface));
export type Surface = z.infer<typeof surfaceSchema>;

export interface Location {
  path: string;
  line: number;
  column: number;
  label: string;
  symbol?: string;
  symbolKind?: number;
  group?: TabGroup;
  tab?: string;
}

export interface ViewState {
  layoutVersion: 1;
  repositoryIds?: string[];
  islandCollapsed?: boolean;
  tabs: Surface[];
  active: Surface | null;
  expanded: string[];
  changes: boolean;
  surface: Surface | null;
  rightTabs: Surface[];
  rightPanelOpen?: boolean;
  bottomSurface: Surface | null;
  bottomTabs: Surface[];
  history: Location[];
  historyIndex: number;
  editorViews: Record<string, editor.ICodeEditorViewState>;
  definitionSources?: Record<string, Omit<Input<'python.source'>, 'sessionId'>>;
}

export const emptyView = (): ViewState => ({
  layoutVersion: 1,
  tabs: [],
  active: null,
  expanded: [],
  changes: false,
  surface: null,
  rightTabs: [],
  bottomSurface: null,
  bottomTabs: [],
  history: [],
  historyIndex: -1,
  editorViews: {},
});

export const surfaceKey = (s: Surface) =>
  s.kind === 'files'
    ? 'files'
    : s.kind === 'terminal'
      ? `terminal:${s.id}`
      : s.kind === 'file'
        ? fileTabKey(s)
        : s.kind === 'diff'
          ? `diff:${s.path ?? ''}`
          : s.kind === 'pr'
            ? `pr:${s.repositoryId ?? ''}:${s.ref ? JSON.stringify(s.ref) : (s.number ?? '')}`
            : `browser:${s.url}`;

export type TabGroup = 'main' | 'right' | 'bottom';

export type TabCloseScope = 'this' | 'others' | 'left' | 'right' | 'all';

export function tabsToClose(tabs: Surface[], key: string, scope: TabCloseScope) {
  const index = tabs.findIndex((tab) => surfaceKey(tab) === key);
  if (index < 0) return [];
  return tabs
    .filter(
      (_, i) =>
        scope === 'all' ||
        (scope === 'this' && i === index) ||
        (scope === 'others' && i !== index) ||
        (scope === 'left' && i < index) ||
        (scope === 'right' && i > index),
    )
    .map(surfaceKey);
}

export const activeFile = (view?: ViewState) =>
  view?.active?.kind === 'file' ? view.active.path : null;

export const rightPanelVisible = (view: ViewState) => view.rightPanelOpen ?? !!view.surface;

export const editorViewKey = (group: TabGroup, path: string) =>
  `${group === 'right' ? 'side' : group}:${path}`;

export const tabGroup = (view: ViewState, group: TabGroup) =>
  group === 'main'
    ? { tabs: view.tabs, active: view.active }
    : group === 'right'
      ? { tabs: view.rightTabs, active: view.surface }
      : { tabs: view.bottomTabs, active: view.bottomSurface };

export const setTabGroup = (
  view: ViewState,
  group: TabGroup,
  tabs: Surface[],
  active: Surface | null,
): ViewState => ({
  ...view,
  ...(group === 'main'
    ? { tabs, active }
    : group === 'right'
      ? { rightTabs: tabs, surface: active, rightPanelOpen: !!active }
      : { bottomTabs: tabs, bottomSurface: active }),
});

export function mapViewFiles(view: ViewState, rewrite: (path: string) => string | null) {
  let next = view;
  for (const group of ['main', 'right', 'bottom'] as const) {
    const { tabs, active } = tabGroup(next, group);
    const retained = tabs.flatMap((tab) => {
      const mapped = mapSurfaceFiles(tab, rewrite);
      return mapped ? [mapped] : [];
    });
    const selected = active
      ? (retained.find((tab) => surfaceKey(tab) === surfaceKey(active)) ?? retained.at(-1) ?? null)
      : null;
    next = setTabGroup(next, group, retained, selected);
  }
  return { ...next, rightPanelOpen: view.rightPanelOpen };
}

export function moveTab(
  view: ViewState,
  from: TabGroup,
  to: TabGroup,
  key: string,
  before?: string,
) {
  const source = tabGroup(view, from);
  const tab = source.tabs.find((tab) => surfaceKey(tab) === key);
  if (!tab || (from === to && key === before)) return view;
  const remaining = source.tabs.filter((tab) => surfaceKey(tab) !== key);
  const active =
    source.active && surfaceKey(source.active) === key ? (remaining.at(-1) ?? null) : source.active;
  const next = setTabGroup(view, from, remaining, active);
  const destination = tabGroup(next, to);
  const tabs = destination.tabs.filter((tab) => surfaceKey(tab) !== key);
  const index = before ? tabs.findIndex((tab) => surfaceKey(tab) === before) : -1;
  tabs.splice(index < 0 ? tabs.length : index, 0, tab);
  const result = setTabGroup(next, to, tabs, from === to ? source.active : tab);
  if (tab.kind === 'file' && from !== to) {
    result.editorViews = { ...view.editorViews };
    for (const path of surfacePaths(tab)) {
      const state = view.editorViews[editorViewKey(from, path)];
      if (state) result.editorViews[editorViewKey(to, path)] = state;
    }
    result.history = view.history.map((item) =>
      item.tab === key && (item.group ?? 'main') === from ? { ...item, group: to } : item,
    );
  }
  return result;
}

export function restoreView(source: object, runIds = new Set<string>()): ViewState {
  const saved = source as Record<string, unknown>;
  const surface = (value: unknown): Surface | null => {
    if (typeof value === 'string') return { kind: 'file', path: value };
    const parsed = surfaceSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value
          .flatMap((item) => {
            const tab = surface(item);
            return tab ? [tab] : [];
          })
          .slice(0, 80)
      : [];
  const view = {
    ...emptyView(),
    ...saved,
    layoutVersion: 1,
    tabs: list(saved.tabs),
    active: surface(saved.active),
    rightTabs: list(saved.rightTabs),
    surface: surface(saved.surface),
    bottomTabs: list(saved.bottomTabs),
    bottomSurface: surface(saved.bottomSurface),
    editorViews: saved.editorViews ?? {},
    history: Array.isArray(saved.history) ? saved.history.slice(-100) : [],
    repositoryIds: Array.isArray(saved.repositoryIds)
      ? saved.repositoryIds.filter((id) => typeof id === 'string')
      : undefined,
  } as ViewState;
  if (saved.surface != null && !view.surface) view.surface = view.rightTabs.at(-1) ?? null;
  if (saved.layoutVersion !== 1) {
    const old = Array.isArray(saved.terminalTabs)
      ? saved.terminalTabs
          .filter((id): id is string => typeof id === 'string')
          .map((id): Surface => ({ kind: 'terminal', id }))
      : [];
    for (const tab of [...old, ...view.rightTabs.filter((tab) => tab.kind === 'terminal')])
      if (!view.bottomTabs.some((existing) => surfaceKey(existing) === surfaceKey(tab)))
        view.bottomTabs.push(tab);
    if (view.surface?.kind === 'terminal') {
      view.bottomSurface = view.surface;
      view.surface = null;
    } else if (typeof saved.terminal === 'string')
      view.bottomSurface = { kind: 'terminal', id: saved.terminal };
    view.rightTabs = view.rightTabs.filter((tab) => tab.kind !== 'terminal');
  }
  for (const group of ['main', 'right', 'bottom'] as const) {
    const { tabs, active } = tabGroup(view, group);
    const retained = tabs.filter((tab) => tab.kind !== 'terminal' || runIds.has(tab.id));
    const selected =
      active && retained.some((tab) => surfaceKey(tab) === surfaceKey(active))
        ? retained.find((tab) => surfaceKey(tab) === surfaceKey(active))!
        : active
          ? (retained.at(-1) ?? null)
          : null;
    Object.assign(view, setTabGroup(view, group, retained, selected));
  }
  view.rightPanelOpen =
    typeof saved.rightPanelOpen === 'boolean' ? saved.rightPanelOpen : !!view.surface;
  return view;
}
