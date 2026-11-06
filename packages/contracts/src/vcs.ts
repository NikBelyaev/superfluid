import { z } from 'zod';
import { id, path } from './schema';
import type { Session } from './project';

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
  changes: { insertions: number; deletions: number };
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

export const vcsRequests = {
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
} as const;

export interface VcsResults {
  'git.status': GitStatus;
  'git.init': Session[];
  'git.diff': string;
  'git.act': Operation;
  'git.inspect': { operation: Operation; log: string; remote: string };
  'git.acknowledge': Operation;
}
