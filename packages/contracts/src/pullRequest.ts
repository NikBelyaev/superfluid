import { z } from 'zod';
import { id } from './schema';

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

export const pullRequestRequests = {
  'pr.read': z.object({ sessionId: id, number: z.number().int().positive().optional() }),
  'pr.comment': z.object({
    sessionId: id,
    number: z.number().int().positive(),
    body: z.string().min(1).max(65536),
  }),
  'pr.patch': z.object({ sessionId: id, number: z.number().int().positive() }),
} as const;

export interface PullRequestResults {
  'pr.read': PullRequest;
  'pr.comment': null;
  'pr.patch': string;
}
