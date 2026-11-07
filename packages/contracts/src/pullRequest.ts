import { z } from 'zod';
import { id } from './schema';
import {
  projectPath,
  type HostingContext,
  type SourceControlDiscovery,
  type RepositoryRemotes,
  type SourceControlRepository,
} from './hosting';

export const pullRequestRefSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  host: z.string().min(1).max(255),
  project: z.string().min(1).max(1024),
  number: z.number().int().positive(),
});
export type PullRequestRef = z.infer<typeof pullRequestRefSchema>;
export interface PullRequestSummary {
  ref: PullRequestRef;
  number: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  url: string;
  author: { login: string } | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
  updatedAt: string;
}
export interface PullRequest extends PullRequestSummary {
  additions: number | null;
  deletions: number | null;
  changedFiles: string | null;
  statusCheckRollup: { name: string; state: string }[];
}
export interface PullRequestComment {
  id: string;
  author: { login: string } | null;
  body: string;
  createdAt: string;
}
export interface PullRequestActivity {
  id: string;
  title: string;
  body: string;
  date: string;
}
export interface Page<T> {
  items: T[];
  hasMore: boolean;
}
export const pullRequestChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(65536).optional(),
    baseRefName: z.string().min(1).max(200).optional(),
    draft: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'Choose a field to update.',
  );
export type PullRequestChanges = z.infer<typeof pullRequestChangesSchema>;
const repository = { sessionId: id, repositoryId: id.optional() };
const selected = { ...repository, ref: pullRequestRefSchema };
const page = z.number().int().min(1).max(10000).default(1);
export const pullRequestRequests = {
  'sourceControl.discovery': z.object({}),
  'sourceControl.repository': z.object(repository),
  'pr.context': z.object({ ...repository, targetProject: projectPath.optional() }),
  'pr.remotes': z.object(repository),
  'pr.list': z.object({
    ...repository,
    scope: z.enum(['branch', 'repository']),
    state: z.enum(['open', 'closed', 'merged', 'all']).default('open'),
    page,
  }),
  'pr.read': z.object({
    ...repository,
    ref: pullRequestRefSchema.optional(),
    number: z.number().int().positive().optional(),
  }),
  'pr.comments': z.object({ ...selected, page }),
  'pr.timeline': z.object({ ...selected, page }),
  'pr.comment': z.object({ ...selected, body: z.string().trim().min(1).max(65536) }),
  'pr.patch': z.object(selected),
  'pr.update': z.object({
    ...selected,
    expectedUpdatedAt: z.string().min(1),
    changes: pullRequestChangesSchema,
  }),
} as const;
export interface PullRequestResults {
  'sourceControl.discovery': SourceControlDiscovery;
  'sourceControl.repository': SourceControlRepository | null;
  'pr.context': HostingContext;
  'pr.remotes': RepositoryRemotes;
  'pr.list': Page<PullRequestSummary>;
  'pr.read': PullRequest;
  'pr.comments': Page<PullRequestComment>;
  'pr.timeline': Page<PullRequestActivity>;
  'pr.comment': null;
  'pr.patch': string;
  'pr.update': PullRequest;
}
