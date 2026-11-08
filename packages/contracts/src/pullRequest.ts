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
const mergeMethod = z.enum(['merge', 'squash', 'rebase']);
export type PullRequestMergeMethod = z.infer<typeof mergeMethod>;
const reviewedHead = z.string().regex(/^[a-f0-9]{40,64}$/i);
const mergeAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge'), method: mergeMethod, expectedHeadSha: reviewedHead }),
  z.object({ action: z.literal('auto'), method: mergeMethod, expectedHeadSha: reviewedHead }),
  z.object({ action: z.literal('cancel-auto'), expectedHeadSha: reviewedHead }),
]);
export type PullRequestMergeAction = z.infer<typeof mergeAction>;
export interface PullRequestMergeState {
  state: 'open' | 'merged' | 'closed';
  headSha: string | null;
  draft: boolean;
  hasConflicts: boolean;
  methods: PullRequestMergeMethod[];
  defaultMethod: PullRequestMergeMethod | null;
  canManage: boolean;
  canMerge: boolean;
  canAutoMerge: boolean;
  autoMerge: boolean;
  reason: string | null;
}
export interface PullRequestCheck {
  kind?: 'pipeline';
  id?: number;
  name: string;
  state: string;
  url?: string;
  stage?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  duration?: number | null;
  allowFailure?: boolean;
}
export function pullRequestCheckState(check: PullRequestCheck) {
  if (check.state === 'MANUAL' && check.allowFailure) return 'skipped';
  if (/^(FAILURE|FAILED|ERROR|TIMED_OUT|STARTUP_FAILURE)$/.test(check.state))
    return check.allowFailure ? 'warning' : 'failed';
  if (
    /^(PENDING|IN_PROGRESS|RUNNING|QUEUED|WAITING|REQUESTED|PREPARING|CREATED|WAITING_FOR_RESOURCE|SCHEDULED)$/.test(
      check.state,
    )
  )
    return 'pending';
  if (/^(MANUAL|BLOCKED|ACTION_REQUIRED)$/.test(check.state)) return 'blocked';
  if (/^(SUCCESS|PASSED|NEUTRAL)$/.test(check.state)) return 'passed';
  if (/^(CANCELLED|CANCELED|SKIPPED)$/.test(check.state)) return 'skipped';
  return 'unknown';
}
export function summarizePullRequestChecks(checks: PullRequestCheck[]) {
  const jobs = checks.filter((check) => check.kind !== 'pipeline');
  const counted = jobs.length ? jobs : checks;
  const states = counted.map(pullRequestCheckState);
  const pipeline = checks.find((check) => check.kind === 'pipeline');
  const pipelineState = pipeline && pullRequestCheckState(pipeline);
  const jobState =
    (['failed', 'pending', 'blocked', 'warning', 'unknown', 'passed', 'skipped'] as const).find(
      (state) => states.includes(state),
    ) ?? 'unknown';
  const state = states.includes('failed')
    ? 'failed'
    : pipelineState && pipelineState !== 'passed'
      ? pipelineState
      : jobState;
  return {
    state,
    count: states.filter((value) => value === state).length || (pipeline ? 1 : 0),
    total: counted.length,
  };
}
export interface PullRequestJobLog {
  text: string;
  truncated: boolean;
}
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
  statusCheckRollup?: PullRequestCheck[];
  checksError?: string;
}
export interface PullRequest extends PullRequestSummary {
  additions: number | null;
  deletions: number | null;
  changedFiles: string | null;
  statusCheckRollup: PullRequestCheck[];
}
export type PullRequestChecks = Pick<
  PullRequest,
  'headRefOid' | 'statusCheckRollup' | 'checksError'
>;
export interface PullRequestComment {
  id: string;
  author: { login: string } | null;
  body: string;
  createdAt: string;
}
export interface PullRequestActivity {
  id: string;
  title: string;
  action?: string;
  body: string;
  date: string;
  commits?: { sha: string; title: string }[];
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
  'pr.checks': z.object(selected),
  'pr.timeline': z.object({ ...selected, page }),
  'pr.comment': z.object({ ...selected, body: z.string().trim().min(1).max(65536) }),
  'pr.jobLog': z.object({ ...selected, jobId: z.number().int().positive().safe() }),
  'pr.mergeState': z.object(selected),
  'pr.merge': z.intersection(z.object(selected), mergeAction),
  'pr.patch': z.object({
    ...selected,
    commit: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/i)
      .optional(),
  }),
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
  'pr.checks': PullRequestChecks;
  'pr.timeline': Page<PullRequestActivity>;
  'pr.comment': null;
  'pr.jobLog': PullRequestJobLog;
  'pr.mergeState': PullRequestMergeState;
  'pr.merge': PullRequestMergeState;
  'pr.patch': string;
  'pr.update': PullRequest;
}
