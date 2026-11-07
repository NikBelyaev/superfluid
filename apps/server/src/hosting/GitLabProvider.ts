import { z } from 'zod';
import { projectPath, type PullRequestChanges } from '@superfluid/contracts';
import {
  pageSize,
  repositoryUrl,
  requestRef,
  type RunHosting,
  type HostingProvider,
  type HostingTarget,
  type PullRequestQuery,
  type CreatePullRequest,
} from './HostingProvider';

const user = z.object({ username: z.string() }).nullable();
const mergeRequest = z.object({
  iid: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  state: z.string(),
  web_url: z.url(),
  author: user,
  source_branch: z.string(),
  target_branch: z.string(),
  sha: z.string().nullable(),
  updated_at: z.string(),
  source_project_id: z.number().nullable(),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  changes_count: z.string().nullable().optional(),
  head_pipeline: z
    .object({ name: z.string().nullable().optional(), status: z.string() })
    .nullable()
    .optional(),
});
const note = z.object({
  id: z.number(),
  author: user,
  body: z.string(),
  created_at: z.string(),
  system: z.boolean(),
});
const discussion = z.object({ id: z.string(), notes: z.array(note) });

export class GitLabProvider implements HostingProvider {
  constructor(private run: RunHosting) {}
  private call(target: HostingTarget, args: string[], input?: string) {
    return this.run('glab', [...args, '--repo', repositoryUrl(target)], target, input);
  }
  async defaultBranch(target: HostingTarget) {
    return (await this.repository(target)).defaultBranch;
  }
  async repository(target: HostingTarget) {
    const raw = await this.run(
      'glab',
      ['repo', 'view', repositoryUrl(target), '--output', 'json'],
      target,
    );
    const value = z
      .object({
        default_branch: z.string().min(1),
        forked_from_project: z.object({ path_with_namespace: projectPath }).nullish(),
      })
      .parse(JSON.parse(raw));
    return {
      defaultBranch: value.default_branch,
      upstreamProject: value.forked_from_project?.path_with_namespace ?? null,
    };
  }
  private normalize(target: HostingTarget, value: z.infer<typeof mergeRequest>) {
    return {
      ref: requestRef(target, value.iid),
      number: value.iid,
      title: value.title,
      body: value.description ?? '',
      state: value.state === 'opened' ? 'open' : value.state,
      draft: value.draft ?? value.work_in_progress ?? false,
      url: value.web_url,
      author: value.author ? { login: value.author.username } : null,
      baseRefName: value.target_branch,
      headRefName: value.source_branch,
      headRefOid: value.sha,
      updatedAt: value.updated_at,
    };
  }
  async list(target: HostingTarget, query: PullRequestQuery) {
    const raw = await this.call(target, [
      'mr',
      'list',
      '--output',
      'json',
      '--page',
      String(query.page),
      '--per-page',
      String(pageSize),
      ...(query.state === 'all'
        ? ['--all']
        : query.state === 'merged'
          ? ['--merged']
          : query.state === 'closed'
            ? ['--closed']
            : []),
      ...(query.branch ? ['--source-branch', query.branch] : []),
      ...(query.base ? ['--target-branch', query.base] : []),
    ]);
    const values = z.array(mergeRequest).parse(JSON.parse(raw));
    let items = values;
    if (query.branch) {
      const source = { ...target, targetProject: target.sourceProject };
      const rawSource = await this.run(
        'glab',
        ['repo', 'view', repositoryUrl(source), '--output', 'json'],
        source,
      );
      const { id } = z.object({ id: z.number() }).parse(JSON.parse(rawSource));
      items = values.filter((item) => item.source_project_id === id);
    }
    return {
      items: items.map((value) => this.normalize(target, value)),
      hasMore: values.length === pageSize,
    };
  }
  async read(target: HostingTarget, number: number) {
    const raw = await this.call(target, ['mr', 'view', String(number), '--output', 'json']);
    const value = mergeRequest.parse(JSON.parse(raw));
    return {
      ...this.normalize(target, value),
      additions: null,
      deletions: null,
      changedFiles: value.changes_count || null,
      statusCheckRollup: value.head_pipeline
        ? [
            {
              name: value.head_pipeline.name ?? 'Pipeline',
              state: value.head_pipeline.status.toUpperCase(),
            },
          ]
        : [],
    };
  }
  patch(target: HostingTarget, number: number) {
    return this.call(target, ['mr', 'diff', String(number), '--raw', '--color=never']);
  }
  private async discussions(target: HostingTarget, number: number, page: number) {
    const raw = await this.call(target, [
      'mr',
      'view',
      String(number),
      '--comments',
      '--system-logs',
      '--output',
      'json',
      '--page',
      String(page),
      '--per-page',
      String(pageSize),
    ]);
    return z.object({ Discussions: z.array(discussion) }).parse(JSON.parse(raw)).Discussions;
  }
  async comments(target: HostingTarget, number: number, page: number) {
    const discussions = await this.discussions(target, number, page);
    return {
      items: discussions.flatMap((item) =>
        item.notes
          .filter((item) => !item.system)
          .map((item) => ({
            id: String(item.id),
            author: item.author ? { login: item.author.username } : null,
            body: item.body,
            createdAt: item.created_at,
          })),
      ),
      hasMore: discussions.length === pageSize,
    };
  }
  async timeline(target: HostingTarget, number: number, page: number) {
    const discussions = await this.discussions(target, number, page);
    return {
      items: discussions.flatMap((item) =>
        item.notes
          .filter((item) => item.system)
          .map((item) => ({
            id: String(item.id),
            title: item.author?.username ?? 'GitLab',
            body: item.body,
            date: item.created_at,
          })),
      ),
      hasMore: discussions.length === pageSize,
    };
  }
  async create(target: HostingTarget, input: CreatePullRequest) {
    const raw = await this.call(
      target,
      [
        'mr',
        'create',
        '--source-branch',
        input.head,
        '--target-branch',
        input.base,
        '--title',
        input.title,
        '--description-file',
        '-',
        '--yes',
        '--push=false',
        '--head',
        repositoryUrl(target, true),
        ...(input.draft ? ['--draft'] : []),
      ],
      input.body,
    );
    const match = raw.match(/https:\/\/[^\s]+\/-\/merge_requests\/(\d+)/g)?.at(-1);
    if (!match || new URL(match).host !== target.host)
      throw new Error(
        'Unexpected merge request creation response. Inspect GitLab before retrying.',
      );
    return { url: match, ref: requestRef(target, Number(match.match(/\/(\d+)$/)![1])) };
  }
  async update(target: HostingTarget, number: number, changes: PullRequestChanges) {
    if (changes.body !== '' || Object.keys(changes).some((key) => key !== 'body'))
      await this.call(
        target,
        [
          'mr',
          'update',
          String(number),
          '--yes',
          ...(changes.title !== undefined ? ['--title', changes.title] : []),
          ...(changes.body !== undefined && changes.body !== '' ? ['--description-file', '-'] : []),
          ...(changes.baseRefName !== undefined ? ['--target-branch', changes.baseRefName] : []),
          ...(changes.draft === undefined ? [] : [changes.draft ? '--draft' : '--ready']),
        ],
        changes.body,
      );
    // glab mr update ignores an empty description, including --description-file -.
    if (changes.body === '')
      await this.run(
        'glab',
        [
          'api',
          `projects/${encodeURIComponent(target.targetProject)}/merge_requests/${number}`,
          '--hostname',
          target.host,
          '--method',
          'PUT',
          '--input',
          '-',
          '--silent',
        ],
        target,
        JSON.stringify({ description: '' }),
      );
  }
  async comment(target: HostingTarget, number: number, body: string) {
    await this.call(target, ['mr', 'note', String(number)], body);
  }
}
