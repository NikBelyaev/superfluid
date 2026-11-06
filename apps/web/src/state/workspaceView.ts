import type { editor } from 'monaco-editor/editor/editor.api';

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

export const emptyView = (): ViewState => ({
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
