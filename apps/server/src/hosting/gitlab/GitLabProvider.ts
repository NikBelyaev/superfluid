import { z } from 'zod';
import {
  projectPath,
  summarizePullRequestChecks,
  type PullRequestChanges,
  type PullRequestCheck,
  type PullRequestMergeState,
  type PullRequestMergeAction,
  type PullRequestMergeMethod,
} from '@superfluid/contracts';
import { git } from '../../vcs/gitCommand';
import { gitLabActivity } from './activity';
import { gitLabCommitPatch } from './commitPatch';
import {
  pageSize,
  repositoryUrl,
  requestRef,
  type RunHosting,
  type RunHostingLog,
  type HostingProvider,
  type HostingTarget,
  type PullRequestQuery,
  type CreatePullRequest,
} from '../HostingProvider';

const user = z.object({ username: z.string() }).nullable();
const pipeline = z.object({
  id: z.number().int().positive().optional(),
  project_id: z.number().int().positive().optional(),
  name: z.string().nullable().optional(),
  status: z.string(),
  sha: z.string().nullish(),
  source: z.string().nullish(),
  ref: z.string().nullish(),
  web_url: z.url().nullish(),
});
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
  detailed_merge_status: z.string().nullish(),
  merge_status: z.string().nullish(),
  has_conflicts: z.boolean().nullish(),
  user: z.object({ can_merge: z.boolean().optional() }).nullish(),
  merge_when_pipeline_succeeds: z.boolean().nullish(),
  auto_merge_enabled: z.boolean().nullish(),
  squash_on_merge: z.boolean().nullish(),
  squash: z.boolean().nullish(),
  work_in_progress: z.boolean().optional(),
  changes_count: z.string().nullable().optional(),
  head_pipeline: pipeline.nullish(),
  pipeline: pipeline.nullish(),
  diff_refs: z
    .object({
      base_sha: z.string().regex(/^[a-f0-9]{40,64}$/i),
      head_sha: z.string().regex(/^[a-f0-9]{40,64}$/i),
    })
    .nullish()
    .catch(null),
});
const note = z.object({
  id: z.number(),
  author: user,
  body: z.string(),
  created_at: z.string(),
  system: z.boolean(),
});
const discussion = z.object({ id: z.string(), notes: z.array(note) });
const job = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  stage: z.string(),
  web_url: z.url(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  duration: z.number().nonnegative().nullish(),
  allow_failure: z.boolean().optional(),
  pipeline: z.object({ id: z.number().int().positive() }),
});

export class GitLabProvider implements HostingProvider {
  constructor(
    private run: RunHosting,
    private log: RunHostingLog = async (...args) => ({
      text: await run(...args),
      truncated: false,
    }),
  ) {}
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
        id: z.number().int().positive().optional(),
        default_branch: z.string().min(1),
        forked_from_project: z.object({ path_with_namespace: projectPath }).nullish(),
      })
      .parse(JSON.parse(raw));
    return {
      id: value.id,
      defaultBranch: value.default_branch,
      upstreamProject: value.forked_from_project?.path_with_namespace ?? null,
    };
  }
  private normalize(
    target: HostingTarget,
    value: z.infer<typeof mergeRequest>,
    check = this.currentPipeline(value),
  ) {
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
      statusCheckRollup: check
        ? [
            {
              kind: 'pipeline' as const,
              name: check.name?.trim() || 'Pipeline',
              state: check.status.toUpperCase(),
              ...(check.web_url ? { url: check.web_url } : {}),
            },
          ]
        : [],
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
    if (query.branch && items.length) {
      const source = { ...target, targetProject: target.sourceProject };
      const id =
        target.sourceProjectId ??
        z
          .object({ id: z.number().int().positive() })
          .parse(
            JSON.parse(
              await this.run(
                'glab',
                ['repo', 'view', repositoryUrl(source), '--output', 'json'],
                source,
              ),
            ),
          ).id;
      items = values.filter((item) => item.source_project_id === id);
    }
    return {
      items: items.map((value) => this.normalize(target, value)),
      hasMore: values.length === pageSize,
    };
  }
  async checks(target: HostingTarget, number: number) {
    const value = mergeRequest.parse(
      JSON.parse(await this.call(target, ['mr', 'view', String(number), '--output', 'json'])),
    );
    return { headRefOid: value.sha, ...(await this.pipelineChecks(target, value)) };
  }
  async read(target: HostingTarget, number: number) {
    const raw = await this.call(target, ['mr', 'view', String(number), '--output', 'json']);
    const value = mergeRequest.parse(JSON.parse(raw));
    const [stats, checks] = await Promise.all([
      this.statistics(target, number, value),
      this.pipelineChecks(target, value),
    ]);
    return {
      ...this.normalize(target, value),
      ...checks,
      additions: stats?.additions ?? null,
      deletions: stats?.deletions ?? null,
      changedFiles: value.changes_count || null,
    };
  }
  async mergeState(target: HostingTarget, number: number): Promise<PullRequestMergeState> {
    const value = mergeRequest.parse(
      JSON.parse(await this.call(target, ['mr', 'view', String(number), '--output', 'json'])),
    );
    const state =
      value.state === 'merged' ? 'merged' : value.state === 'closed' ? 'closed' : 'open';
    const draft = value.draft ?? value.work_in_progress ?? false;
    if (state !== 'open')
      return {
        state,
        draft,
        headSha: value.sha,
        hasConflicts: false,
        methods: [],
        defaultMethod: null,
        canManage: false,
        canMerge: false,
        canAutoMerge: false,
        autoMerge: false,
        reason: null,
      };
    const settings = z
      .object({
        merge_method: z.enum(['merge', 'rebase_merge', 'ff']),
        squash_option: z.enum(['never', 'always', 'default_on', 'default_off']),
      })
      .parse(
        JSON.parse(
          await this.run(
            'glab',
            ['repo', 'view', repositoryUrl(target), '--output', 'json'],
            target,
          ),
        ),
      );
    const normal: PullRequestMergeMethod = settings.merge_method === 'merge' ? 'merge' : 'rebase';
    const methods: PullRequestMergeMethod[] =
      settings.squash_option === 'always'
        ? ['squash']
        : settings.squash_option === 'never'
          ? [normal]
          : [normal, 'squash'];
    const squash = value.squash_on_merge ?? value.squash ?? settings.squash_option === 'default_on';
    const canManage = value.state === 'opened' && value.user?.can_merge === true && !!value.sha;
    const hasConflicts =
      value.has_conflicts === true ||
      value.detailed_merge_status === 'conflict' ||
      value.merge_status === 'cannot_be_merged';
    const status = value.detailed_merge_status ?? value.merge_status ?? 'unchecked';
    const ready = ['mergeable', 'can_be_merged'].includes(status);
    const reasons: Record<string, string> = {
      ci_must_pass: 'Required checks must pass.',
      ci_still_running: 'Waiting for required checks.',
      not_approved: 'Required approvals are missing.',
      discussions_not_resolved: 'Resolve all required discussions.',
      need_rebase: 'The source branch must be rebased.',
      requested_changes: 'A reviewer requested changes.',
      merge_time: 'The merge is scheduled for later.',
      checking: 'GitLab is checking mergeability.',
      unchecked: 'Mergeability has not been checked yet.',
    };
    const reason =
      value.state !== 'opened'
        ? 'GitLab is completing this merge.'
        : !canManage
          ? 'You do not have permission to merge this request.'
          : draft
            ? 'Mark this request ready for review first.'
            : hasConflicts
              ? 'Resolve merge conflicts before merging.'
              : ready
                ? null
                : (reasons[status] ?? `GitLab blocks merging: ${status.replaceAll('_', ' ')}.`);
    const autoKnown =
      value.merge_when_pipeline_succeeds != null || value.auto_merge_enabled != null;
    return {
      state,
      draft,
      headSha: value.sha,
      hasConflicts,
      methods,
      defaultMethod: squash && methods.includes('squash') ? 'squash' : methods[0],
      canManage,
      canMerge: reason === null,
      canAutoMerge:
        canManage &&
        !draft &&
        !hasConflicts &&
        autoKnown &&
        [
          'ci_must_pass',
          'ci_still_running',
          'not_approved',
          'discussions_not_resolved',
          'mergeable',
          'can_be_merged',
        ].includes(status),
      autoMerge: value.merge_when_pipeline_succeeds === true || value.auto_merge_enabled === true,
      reason,
    };
  }
  async merge(target: HostingTarget, number: number, action: PullRequestMergeAction) {
    if (action.action === 'cancel-auto') {
      await this.run(
        'glab',
        [
          'api',
          `projects/${encodeURIComponent(target.targetProject)}/merge_requests/${number}/cancel_merge_when_pipeline_succeeds`,
          '--hostname',
          target.host,
          '--method',
          'POST',
        ],
        target,
      );
      return;
    }
    // GitLab's project setting owns the merge/rebase strategy; --rebase would change the reviewed head.
    await this.call(target, [
      'mr',
      'merge',
      String(number),
      '--yes',
      `--auto-merge=${action.action === 'auto'}`,
      `--squash=${action.method === 'squash'}`,
      '--sha',
      action.expectedHeadSha,
    ]);
  }
  private api(target: HostingTarget, path: string) {
    return this.run('glab', ['api', path, '--hostname', target.host], target);
  }
  private currentPipeline(value: z.infer<typeof mergeRequest>) {
    const current = value.head_pipeline ?? value.pipeline;
    return current && (!current.sha || current.sha === value.sha) ? current : null;
  }
  private async selectedPipeline(target: HostingTarget, value: z.infer<typeof mergeRequest>) {
    const branch = this.currentPipeline(value);
    if (branch) return branch;
    const current = value.head_pipeline ?? value.pipeline;
    if (
      !current?.sha ||
      !value.sha ||
      current.source !== 'merge_request_event' ||
      ![
        `refs/merge-requests/${value.iid}/merge`,
        `refs/merge-requests/${value.iid}/train`,
      ].includes(current.ref ?? '')
    )
      return null;
    const commit = z
      .object({ id: z.string(), parent_ids: z.array(z.string()) })
      .parse(
        JSON.parse(
          await this.api(
            target,
            `projects/${current.project_id ?? encodeURIComponent(target.targetProject)}/repository/commits/${encodeURIComponent(current.sha)}`,
          ),
        ),
      );
    return commit.id === current.sha && commit.parent_ids.includes(value.sha) ? current : null;
  }
  private async pipelineChecks(
    target: HostingTarget,
    value: z.infer<typeof mergeRequest>,
  ): Promise<{ statusCheckRollup: PullRequestCheck[]; checksError?: string }> {
    let fallback: PullRequestCheck[] = [];
    let verified = false;
    try {
      const current = await this.selectedPipeline(target, value);
      verified = true;
      fallback = this.normalize(target, value, current).statusCheckRollup;
      if (!current?.id) return { statusCheckRollup: fallback };
      const jobs: z.infer<typeof job>[] = [];
      for (let page = 1; ; page++) {
        const raw = await this.api(
          target,
          `projects/${current.project_id ?? encodeURIComponent(target.targetProject)}/pipelines/${current.id}/jobs?per_page=100&page=${page}`,
        );
        const values = z.array(job).parse(JSON.parse(raw));
        if (values.some((value) => value.pipeline.id !== current.id))
          throw new Error('GitLab returned jobs outside the current pipeline.');
        jobs.push(...values);
        if (values.length < 100) break;
        if (jobs.length >= 10000)
          throw new Error('This pipeline has too many jobs to preview. Open it on GitLab.');
      }
      if (!jobs.length) return { statusCheckRollup: fallback };
      const checks = jobs
        .sort((a, b) => a.id - b.id)
        .map((job) => ({
          id: job.id,
          name: job.name,
          state: job.status.toUpperCase(),
          stage: job.stage,
          url: job.web_url,
          startedAt: job.started_at,
          completedAt: job.finished_at,
          duration: job.duration,
          allowFailure: job.allow_failure,
        }));
      const differs =
        summarizePullRequestChecks(checks).state !== summarizePullRequestChecks(fallback).state;
      return { statusCheckRollup: differs ? [...checks, ...fallback] : checks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        statusCheckRollup: fallback,
        checksError: !verified
          ? `Could not verify the current pipeline. ${message}`
          : /403|insufficient_granular_scope/i.test(message)
            ? 'GitLab denied access to jobs. Grant Pipeline: Read and Job: Read to this project in your token, then refresh.'
            : `Could not load jobs. ${message}`,
      };
    }
  }
  async jobLog(target: HostingTarget, number: number, jobId: number) {
    const value = mergeRequest.parse(
      JSON.parse(await this.call(target, ['mr', 'view', String(number), '--output', 'json'])),
    );
    const current = await this.selectedPipeline(target, value);
    if (!current?.id) throw new Error('No current pipeline is available for this request.');
    const project = current.project_id ?? encodeURIComponent(target.targetProject);
    try {
      const selected = job.parse(
        JSON.parse(await this.api(target, `projects/${project}/jobs/${jobId}`)),
      );
      if (selected.pipeline.id !== current.id)
        throw new Error('This job does not belong to the current pipeline. Refresh the request.');
      return await this.log(
        'glab',
        ['api', `projects/${project}/jobs/${jobId}/trace`, '--hostname', target.host],
        target,
      );
    } catch (error) {
      if (error instanceof Error && /403|insufficient_granular_scope/i.test(error.message))
        throw new Error(
          'GitLab denied access to job output. Grant Job: Read to this project in your token, then retry.',
        );
      throw error;
    }
  }
  private async statistics(
    target: HostingTarget,
    number: number,
    value: z.infer<typeof mergeRequest>,
  ) {
    try {
      const raw = await this.run(
        'glab',
        [
          'api',
          'graphql',
          '--hostname',
          target.host,
          '--raw-field',
          'query=query($project: ID!, $number: String!) { project(fullPath: $project) { mergeRequest(iid: $number) { diffStatsSummary { additions deletions } } } }',
          '--raw-field',
          `project=${target.targetProject}`,
          '--raw-field',
          `number=${number}`,
        ],
        target,
      );
      const response = z
        .object({
          data: z.object({
            project: z
              .object({
                mergeRequest: z
                  .object({
                    diffStatsSummary: z
                      .object({
                        additions: z.number().int().nonnegative(),
                        deletions: z.number().int().nonnegative(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              })
              .nullable(),
          }),
        })
        .safeParse(JSON.parse(raw));
      const stats = response.success
        ? response.data.data.project?.mergeRequest?.diffStatsSummary
        : null;
      if (stats) return stats;
    } catch {
      /* Statistics are optional; older servers may not expose this GraphQL field. */
    }
    if (value.diff_refs) {
      try {
        const output = await git(target.cwd, [
          'diff',
          '--numstat',
          '--no-ext-diff',
          '--no-textconv',
          value.diff_refs.base_sha,
          value.diff_refs.head_sha,
          '--',
        ]);
        let additions = 0,
          deletions = 0;
        for (const row of output.matchAll(/^(\d+)\t(\d+)\t/gm)) {
          additions += Number(row[1]);
          deletions += Number(row[2]);
        }
        return { additions, deletions };
      } catch {
        /* Local base objects are not guaranteed to exist in a fork or shallow checkout. */
      }
    }
    return null;
  }
  patch(target: HostingTarget, number: number, commit?: string) {
    return commit
      ? gitLabCommitPatch(this.run, target, commit)
      : this.call(target, ['mr', 'diff', String(number), '--raw', '--color=never']);
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
            ...gitLabActivity(item.body),
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
