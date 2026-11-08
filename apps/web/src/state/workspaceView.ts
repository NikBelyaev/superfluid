import type { editor } from 'monaco-editor/editor/editor.api';
import { z } from 'zod';
import { pullRequestRefSchema, type Input } from '@superfluid/contracts';

export const surfaceSchema = z.discriminatedUnion('kind', [
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
  z.object({ kind: z.literal('file'), path: z.string() }),
]);
export type Surface = z.infer<typeof surfaceSchema>;

export interface Location {
  path: string;
  line: number;
  column: number;
  label: string;
  symbol?: string;
  symbolKind?: number;
}

export interface ViewState {
  repositoryIds?: string[];
  islandCollapsed?: boolean;
  tabs: string[];
  active: string | null;
  expanded: string[];
  changes: boolean;
  surface: Surface | null;
  rightTabs: Surface[];
  history: Location[];
  historyIndex: number;
  editorViews: Record<string, editor.ICodeEditorViewState>;
  definitionSources?: Record<string, Omit<Input<'python.source'>, 'sessionId'>>;
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
          ? `pr:${s.repositoryId ?? ''}:${s.ref ? JSON.stringify(s.ref) : (s.number ?? '')}`
          : `browser:${s.url}`;
