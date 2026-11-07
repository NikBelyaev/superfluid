import type {
  HostingContext,
  Page,
  PullRequest,
  PullRequestSummary,
  PullRequestChanges,
  PullRequestComment,
  PullRequestActivity,
} from '@superfluid/contracts';

export interface HostingTarget extends HostingContext {
  cwd: string;
  remoteUrl: string;
}
export interface PullRequestQuery {
  state: 'open' | 'closed' | 'merged' | 'all';
  page: number;
  branch?: string;
  base?: string;
}
export interface CreatePullRequest {
  title: string;
  body: string;
  draft: boolean;
  head: string;
  base: string;
}
export type RunHosting = (
  file: string,
  args: string[],
  target: HostingTarget,
  input?: string,
) => Promise<string>;
export interface HostingProvider {
  repository(
    target: HostingTarget,
  ): Promise<{ defaultBranch: string; upstreamProject: string | null }>;
  defaultBranch(target: HostingTarget): Promise<string>;
  list(target: HostingTarget, query: PullRequestQuery): Promise<Page<PullRequestSummary>>;
  read(target: HostingTarget, number: number): Promise<PullRequest>;
  patch(target: HostingTarget, number: number): Promise<string>;
  comments(target: HostingTarget, number: number, page: number): Promise<Page<PullRequestComment>>;
  timeline(target: HostingTarget, number: number, page: number): Promise<Page<PullRequestActivity>>;
  create(
    target: HostingTarget,
    input: CreatePullRequest,
  ): Promise<Pick<PullRequestSummary, 'url' | 'ref'>>;
  update(target: HostingTarget, number: number, changes: PullRequestChanges): Promise<void>;
  comment(target: HostingTarget, number: number, body: string): Promise<void>;
}

export const pageSize = 30;
export function pageOf<T>(items: T[], page: number): Page<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), hasMore: items.length > start + pageSize };
}
export function requestRef(target: HostingTarget, number: number) {
  return { provider: target.provider, host: target.host, project: target.targetProject, number };
}
export function repositoryUrl(target: HostingTarget, source = false) {
  return `https://${target.host}/${source ? target.sourceProject : target.targetProject}`;
}
