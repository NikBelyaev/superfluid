import { z } from 'zod';
import type { GhosttySnapshot, GhosttyRow } from '../ghostty/core';

const id = z.string().min(1).max(200);
const path = z.string().max(4096);
const text = z.string().max(2 * 1024 * 1024);
export const actionSchema = z.object({
  id: id.optional(),
  projectId: id,
  name: z.string().min(1).max(80),
  kind: z.enum(['shell', 'python', 'django']),
  command: z.string().min(1).max(8192),
  cwd: path.default(''),
  shortcut: z.string().max(80).default(''),
  previewUrl: z.string().max(2048).default(''),
});
export const requests = {
  bootstrap: z.object({}),
  'project.add': z.object({ path }),
  'project.clone': z.object({ url: z.string().min(1).max(2048), destination: path }),
  'session.list': z.object({ projectId: id }),
  'session.create': z.object({
    sessionId: id,
    branch: z.string().min(1).max(160),
    base: z.string().min(1).max(200),
  }),
  'session.state': z.object({ sessionId: id, state: z.record(z.string(), z.unknown()) }),
  'session.interpreter': z.object({ sessionId: id, python: path }),
  'files.list': z.object({ sessionId: id, path: path.default('') }),
  'files.read': z.object({ sessionId: id, path, diskOnly: z.boolean().default(false) }),
  'files.save': z.object({ sessionId: id, path, text, hash: z.string().max(128) }),
  'files.create': z.object({ sessionId: id, path, directory: z.boolean().default(false) }),
  'files.rename': z.object({ sessionId: id, path, target: path }),
  'files.resolve': z.object({ sessionId: id, path }),
  'files.search': z.object({
    sessionId: id,
    query: z.string().max(500),
    content: z.boolean().default(false),
  }),
  'draft.put': z.object({
    sessionId: id,
    path,
    text,
    version: z.number().int().min(0),
    hash: z.string().max(128),
  }),
  'draft.drop': z.object({ sessionId: id, path, version: z.number().int().min(0) }),
  'git.status': z.object({ sessionId: id }),
  'git.init': z.object({ sessionId: id }),
  'git.diff': z.object({
    sessionId: id,
    path: path.optional(),
    mode: z.enum(['unstaged', 'staged', 'branch']).default('unstaged'),
    base: z.string().max(200).default('HEAD'),
  }),
  'git.act': z.object({
    sessionId: id,
    operationId: id,
    action: z.enum(['commit', 'push', 'pr', 'publish']),
    message: z.string().max(8192).default(''),
    paths: z.array(path).max(1000).default([]),
    base: z.string().max(200).default('main'),
    title: z.string().max(200).default(''),
    body: z.string().max(65536).default(''),
    draft: z.boolean().default(true),
  }),
  'git.inspect': z.object({ sessionId: id, operationId: id }),
  'git.acknowledge': z.object({ sessionId: id, operationId: id }),
  'actions.save': actionSchema,
  'actions.delete': z.object({ id }),
  'terminal.run': z.object({
    sessionId: id,
    actionId: id.optional(),
    name: z.string().max(80).default('Terminal'),
    command: z.string().max(8192).default(''),
  }),
  'terminal.command': z.object({
    id,
    command: z.enum([
      'attach',
      'detach',
      'ack',
      'resize',
      'key',
      'text',
      'stop',
      'scroll',
      'select',
      'copy',
      'rename',
    ]),
    data: z.unknown().optional(),
  }),
  'lsp.open': z.object({ sessionId: id, path, text, version: z.number().int().min(0) }),
  'lsp.close': z.object({ sessionId: id, path }),
  'lsp.request': z.object({
    sessionId: id,
    method: z.enum([
      'textDocument/completion',
      'textDocument/hover',
      'textDocument/definition',
      'textDocument/typeDefinition',
      'textDocument/implementation',
      'textDocument/references',
      'textDocument/documentSymbol',
      'textDocument/rename',
      'textDocument/prepareRename',
    ]),
    params: z.record(z.string(), z.unknown()),
  }),
  'python.format': z.object({ sessionId: id, text }),
  'pr.read': z.object({ sessionId: id, number: z.number().int().positive().optional() }),
  'pr.comment': z.object({
    sessionId: id,
    number: z.number().int().positive(),
    body: z.string().min(1).max(65536),
  }),
  'pr.patch': z.object({ sessionId: id, number: z.number().int().positive() }),
} as const;

export type Method = keyof typeof requests;
export type Input<M extends Method> = z.input<(typeof requests)[M]>;
export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}
export interface Session {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  head: string;
  gitDir: string;
  python: string;
  state: Record<string, unknown>;
  available: boolean;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}
export interface DocumentData {
  path: string;
  text: string;
  hash: string;
  diskText?: string;
  recovered?: boolean;
  version: number;
}
export interface Draft {
  sessionId: string;
  path: string;
  text: string;
  hash: string;
  version: number;
  updatedAt: number;
}
export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  original?: string;
}
export interface GitStatus {
  branch: string;
  head: string;
  upstream: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  branches: string[];
  repo: boolean;
}
export type Action = z.output<typeof actionSchema> & { id: string };
export interface Run {
  id: string;
  sessionId: string;
  name: string;
  command: string;
  state: 'starting' | 'running' | 'exited' | 'failed';
  exitCode?: number;
  startedAt: number;
  previewUrl?: string;
}
export interface Operation {
  id: string;
  sessionId: string;
  phase: string;
  error?: string;
  commit?: string;
  url?: string;
  evidence: Record<string, unknown>;
}
export interface SearchHit {
  path: string;
  line?: number;
  text?: string;
}
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  author: { login: string } | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: any[];
  commits: any[];
  reviews: any[];
  statusCheckRollup: any[];
  files: any[];
}
export type TerminalFrame = {
  id: string;
  sequence: number;
  chunk: number;
  full: boolean;
  header: Omit<GhosttySnapshot, 'rowData' | 'dirtyRows'>;
  rows: [number, GhosttyRow][];
  last: boolean;
};
export type AppEvent =
  | { type: 'terminal.frame'; frame: TerminalFrame }
  | { type: 'runs'; runs: Run[] }
  | { type: 'operation'; operation: Operation }
  | { type: 'files.changed'; sessionId: string }
  | { type: 'diagnostics'; sessionId: string; generation: number; uri: string; diagnostics: any[] }
  | { type: 'lsp.status'; sessionId: string; status: string }
  | { type: 'error'; message: string };

export interface Results {
  bootstrap: { projects: Project[]; actions: Action[]; runs: Run[]; operations: Operation[] };
  'project.add': Project;
  'project.clone': Project;
  'session.list': Session[];
  'session.create': Session;
  'session.state': null;
  'session.interpreter': Session;
  'files.list': FileEntry[];
  'files.read': DocumentData;
  'files.save': { hash: string };
  'files.create': null;
  'files.rename': null;
  'files.resolve': string;
  'files.search': { hits: SearchHit[]; truncated: boolean };
  'draft.put': { version: number; updatedAt: number };
  'draft.drop': null;
  'git.status': GitStatus;
  'git.init': Session[];
  'git.diff': string;
  'git.act': Operation;
  'git.inspect': { operation: Operation; log: string; remote: string };
  'git.acknowledge': Operation;
  'actions.save': Action;
  'actions.delete': null;
  'terminal.run': Run;
  'terminal.command': any;
  'lsp.open': null;
  'lsp.close': null;
  'lsp.request': any;
  'python.format': string;
  'pr.read': PullRequest;
  'pr.comment': null;
  'pr.patch': string;
}
export interface Bridge {
  call<M extends Method>(method: M, input: Input<M>): Promise<Results[M]>;
  onEvent(listener: (event: AppEvent) => void): () => void;
  onFlush(listener: () => Promise<void>): () => void;
  chooseProject(): Promise<Project | null>;
  chooseDirectory(): Promise<string | null>;
  exportText(text: string, name: string): Promise<boolean>;
  trash(sessionId: string, path: string): Promise<void>;
  external(url: string): Promise<void>;
  browser(input: {
    url?: string;
    bounds?: { x: number; y: number; width: number; height: number };
    visible: boolean;
  }): Promise<void>;
}
declare global {
  interface Window {
    superfluid: Bridge;
  }
}
