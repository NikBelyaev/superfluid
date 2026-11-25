import { z } from 'zod';
import { id, path } from './schema';
import type { Session } from './project';
import { projectPath } from './hosting';

export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  original?: string;
}

export interface GitRepository {
  id: string;
  path: string;
  branch: string;
  provider?: 'github' | 'gitlab';
}

export interface GitHistoryCommit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: { name: string; kind: 'head' | 'branch' | 'remote' | 'tag' }[];
}

const historyCursor = z.object({
  offset: z.number().int().positive().max(2_147_483_646),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
});

export const gitHistoryCommitTarget = z.object({
  repositoryId: id,
  hash: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
});
export type GitHistoryCommitTarget = z.infer<typeof gitHistoryCommitTarget>;
const historyCommitRequest = gitHistoryCommitTarget.extend({ sessionId: id });

export interface GitStatus {
  branch: string;
  baseBranch?: string;
  head: string;
  upstream: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  branches: string[];
  repo: boolean;
  changes: { insertions: number; deletions: number };
  outgoing?: { insertions: number; deletions: number };
  hasRemote?: boolean;
  remote?: string;
  push?: { ahead: number; behind: number };
  prChanges?: boolean;
  stash?: string;
}

export interface Operation {
  id: string;
  sessionId: string;
  repositoryId?: string;
  phase: string;
  error?: string;
  commit?: string;
  url?: string;
  pullRequest?: import('./pullRequest').PullRequestRef;
  evidence: Record<string, unknown>;
}

export const vcsRequests = {
  'git.worktree': z.object({
    sessionId: id,
    repositoryIds: z.array(id).min(1).max(1000),
    branch: z.string().min(1).max(160),
    base: z.string().min(1).max(200),
  }),
  'git.repositories': z.object({ sessionId: id, refresh: z.boolean().default(false) }),
  'git.status': z.object({ sessionId: id, repositoryId: id.optional() }),
  'git.history': z.object({
    sessionId: id,
    repositoryId: id,
    cursor: historyCursor.optional(),
    query: z
      .string()
      .trim()
      .max(256)
      .refine((value) => !value.includes('\0'))
      .optional(),
  }),
  'git.historyStats': historyCommitRequest,
  'git.historyPatch': historyCommitRequest,
  'git.init': z.object({ sessionId: id }),
  'git.index': z.object({ sessionId: id, repositoryId: id.optional(), path }),
  'git.diff': z.object({
    sessionId: id,
    repositoryId: id.optional(),
    path: path.optional(),
    mode: z.enum(['unstaged', 'staged', 'branch']).default('unstaged'),
    base: z.string().max(200).default('HEAD'),
  }),
  'git.act': z.object({
    sessionId: id,
    repositoryId: id.optional(),
    operationId: id,
    action: z.enum([
      'commit',
      'push',
      'pr',
      'publish',
      'create-branch',
      'checkout',
      'stash',
      'stash-apply',
    ]),
    stash: z
      .string()
      .regex(/^[0-9a-f]{40,64}$/)
      .optional(),
    branch: z.string().max(200).default(''),
    message: z.string().max(8192).default(''),
    paths: z.array(path).max(1000).default([]),
    allChanges: z.boolean().default(false),
    base: z.string().max(200).default(''),
    hostingRevision: z.string().optional(),
    targetProject: projectPath.optional(),
    title: z.string().max(200).default(''),
    body: z.string().max(65536).default(''),
    draft: z.boolean().default(true),
  }),
  'git.inspect': z.object({ sessionId: id, operationId: id }),
  'git.acknowledge': z.object({ sessionId: id, operationId: id }),
} as const;

export interface VcsResults {
  'git.worktree': Session;
  'git.repositories': GitRepository[];
  'git.status': GitStatus;
  'git.history': { commits: GitHistoryCommit[]; next: z.infer<typeof historyCursor> | null };
  'git.historyStats': { insertions: number; deletions: number; files: number };
  'git.historyPatch': string;
  'git.init': Session[];
  'git.index': string | null;
  'git.diff': string;
  'git.act': Operation;
  'git.inspect': { operation: Operation; log: string; remote: string };
  'git.acknowledge': Operation;
}
