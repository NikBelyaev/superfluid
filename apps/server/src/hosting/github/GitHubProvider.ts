import { z } from 'zod';
import {
  projectPath,
  type PullRequestChanges,
  type PullRequestMergeState,
  type PullRequestMergeAction,
  type PullRequestMergeMethod,
} from '@superfluid/contracts';
import {
  pageOf,
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

const author = z.object({ login: z.string() }).nullable();
const check = z.object({
  name: z.string().optional(),
  context: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  detailsUrl: z.union([z.url(), z.literal('')]).nullish(),
  targetUrl: z.union([z.url(), z.literal('')]).nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
});
const summary = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  state: z.string(),
  url: z.url(),
  author,
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
  headRepository: z.object({ name: z.string() }).nullable(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable(),
  statusCheckRollup: z.array(check).nullish(),
});
const fields =
  'number,title,body,state,url,author,baseRefName,headRefName,headRefOid,isDraft,updatedAt,headRepository,headRepositoryOwner,statusCheckRollup';
const details = summary.extend({
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  statusCheckRollup: z.array(check).nullable(),
});

export class GitHubProvider implements HostingProvider {
  constructor(
    private run: RunHosting,
    private log: RunHostingLog = async (...args) => ({
      text: await run(...args),
      truncated: false,
    }),
  ) {}
  private call(target: HostingTarget, args: string[], input?: string) {
    return this.run('gh', [...args, '--repo', repositoryUrl(target)], target, input);
  }
  async defaultBranch(target: HostingTarget) {
    return (await this.repository(target)).defaultBranch;
  }
  async repository(target: HostingTarget) {
    const raw = await this.run(
      'gh',
      ['repo', 'view', repositoryUrl(target), '--json', 'defaultBranchRef,parent'],
      target,
    );
    const value = z
      .object({
        defaultBranchRef: z.object({ name: z.string().min(1) }),
        parent: z
          .object({ name: z.string().min(1), owner: z.object({ login: z.string().min(1) }) })
          .nullish(),
      })
      .parse(JSON.parse(raw));
    return {
      defaultBranch: value.defaultBranchRef.name,
      upstreamProject: value.parent
        ? projectPath.parse(`${value.parent.owner.login}/${value.parent.name}`)
        : null,
    };
  }
  private normalize(target: HostingTarget, value: z.infer<typeof summary>) {
    return {
      number: value.number,
      title: value.title,
      body: value.body,
      url: value.url,
      author: value.author,
      baseRefName: value.baseRefName,
      headRefName: value.headRefName,
      headRefOid: value.headRefOid,
      updatedAt: value.updatedAt,
      ref: requestRef(target, value.number),
      draft: value.isDraft,
      state: value.state.toLowerCase(),
      statusCheckRollup: (value.statusCheckRollup ?? []).map((check) => {
        const url = check.detailsUrl || check.targetUrl;
        const parsed = url ? new URL(url) : null;
        const path = parsed?.pathname.match(/\/actions\/runs\/\d+\/job\/(\d+)$/);
        const id =
          parsed?.host === target.host &&
          path &&
          parsed.pathname === `/${target.targetProject}${path[0]}`
            ? Number(path[1])
            : undefined;
        return {
          name: check.name || check.context || 'Check',
          state: check.conclusion || check.status || check.state || 'UNKNOWN',
          ...(url ? { url } : {}),
          ...(id && Number.isSafeInteger(id) ? { id } : {}),
          ...(check.startedAt ? { startedAt: check.startedAt } : {}),
          ...(check.completedAt ? { completedAt: check.completedAt } : {}),
        };
      }),
    };
  }
  async list(target: HostingTarget, query: PullRequestQuery) {
    const raw = await this.call(target, [
      'pr',
      'list',
      '--state',
      query.state,
      '--limit',
      String(query.page * pageSize + 1),
      '--json',
      fields,
      ...(query.branch ? ['--head', query.branch] : []),
      ...(query.base ? ['--base', query.base] : []),
    ]);
    const values = z.array(summary).parse(JSON.parse(raw));
    const page = pageOf(values, query.page);
    const filtered = query.branch
      ? page.items.filter(
          (value) =>
            value.headRepository &&
            value.headRepositoryOwner &&
            `${value.headRepositoryOwner.login}/${value.headRepository.name}`.toLowerCase() ===
              target.sourceProject.toLowerCase(),
        )
      : page.items;
    return { items: filtered.map((value) => this.normalize(target, value)), hasMore: page.hasMore };
  }
  async read(target: HostingTarget, number: number) {
    const raw = await this.call(target, [
      'pr',
      'view',
      String(number),
      '--json',
      fields + ',additions,deletions,changedFiles',
    ]);
    const value = details.parse(JSON.parse(raw));
    return {
      ...this.normalize(target, value),
      additions: value.additions,
      deletions: value.deletions,
      changedFiles: String(value.changedFiles),
    };
  }
  async checks(target: HostingTarget, number: number) {
    const value = this.normalize(
      target,
      summary.parse(
        JSON.parse(await this.call(target, ['pr', 'view', String(number), '--json', fields])),
      ),
    );
    return { headRefOid: value.headRefOid, statusCheckRollup: value.statusCheckRollup };
  }
  async mergeState(target: HostingTarget, number: number): Promise<PullRequestMergeState> {
    const value = z
      .object({
        state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
        isDraft: z.boolean(),
        headRefOid: z.string().regex(/^[a-f0-9]{40,64}$/i),
        mergeable: z.string(),
        mergeStateStatus: z.string(),
        autoMergeRequest: z.object({}).nullish(),
        reviewDecision: z.string().nullish(),
      })
      .parse(
        JSON.parse(
          await this.call(target, [
            'pr',
            'view',
            String(number),
            '--json',
            'state,isDraft,headRefOid,mergeable,mergeStateStatus,autoMergeRequest,reviewDecision',
          ]),
        ),
      );
    const state = value.state === 'OPEN' ? 'open' : value.state === 'MERGED' ? 'merged' : 'closed';
    if (state !== 'open')
      return {
        state,
        draft: value.isDraft,
        headSha: value.headRefOid,
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
        allow_merge_commit: z.boolean(),
        allow_squash_merge: z.boolean(),
        allow_rebase_merge: z.boolean(),
        allow_auto_merge: z.boolean().optional(),
        permissions: z.object({ push: z.boolean() }).optional(),
      })
      .parse(
        JSON.parse(
          await this.run(
            'gh',
            ['api', `repos/${target.targetProject}`, '--hostname', target.host],
            target,
          ),
        ),
      );
    const methods: PullRequestMergeMethod[] = [
      ...(settings.allow_merge_commit ? ['merge' as const] : []),
      ...(settings.allow_squash_merge ? ['squash' as const] : []),
      ...(settings.allow_rebase_merge ? ['rebase' as const] : []),
    ];
    const canManage = settings.permissions?.push === true;
    const hasConflicts = value.mergeable === 'CONFLICTING' || value.mergeStateStatus === 'DIRTY';
    const ready =
      value.mergeable === 'MERGEABLE' &&
      ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(value.mergeStateStatus) &&
      !['REVIEW_REQUIRED', 'CHANGES_REQUESTED'].includes(value.reviewDecision ?? '');
    const reason = !canManage
      ? 'You do not have permission to merge this request.'
      : value.isDraft
        ? 'Mark this request ready for review first.'
        : hasConflicts
          ? 'Resolve merge conflicts before merging.'
          : !methods.length
            ? 'No merge method is enabled for this repository.'
            : ready
              ? null
              : value.reviewDecision === 'REVIEW_REQUIRED'
                ? 'Required approvals are missing.'
                : value.reviewDecision === 'CHANGES_REQUESTED'
                  ? 'A reviewer requested changes.'
                  : value.mergeStateStatus === 'BEHIND'
                    ? 'Update the source branch before merging.'
                    : value.mergeable === 'UNKNOWN' || value.mergeStateStatus === 'UNKNOWN'
                      ? 'GitHub is checking mergeability.'
                      : 'Required checks or branch rules are blocking this merge.';
    return {
      state,
      draft: value.isDraft,
      headSha: value.headRefOid,
      hasConflicts,
      methods,
      defaultMethod: methods[0] ?? null,
      canManage,
      canMerge: reason === null,
      canAutoMerge:
        canManage &&
        !value.isDraft &&
        !hasConflicts &&
        methods.length > 0 &&
        settings.allow_auto_merge === true &&
        value.mergeable !== 'UNKNOWN' &&
        value.mergeStateStatus !== 'UNKNOWN',
      autoMerge: value.autoMergeRequest != null,
      reason,
    };
  }
  async merge(target: HostingTarget, number: number, action: PullRequestMergeAction) {
    await this.call(target, [
      'pr',
      'merge',
      String(number),
      '--match-head-commit',
      action.expectedHeadSha,
      ...(action.action === 'cancel-auto'
        ? ['--disable-auto']
        : [`--${action.method}`, ...(action.action === 'auto' ? ['--auto'] : [])]),
    ]);
  }
  patch(target: HostingTarget, number: number, commit?: string) {
    return commit
      ? this.run(
          'gh',
          [
            'api',
            `repos/${target.targetProject}/commits/${commit}`,
            '--hostname',
            target.host,
            '--header',
            'Accept: application/vnd.github.diff',
          ],
          target,
        )
      : this.call(target, ['pr', 'diff', String(number), '--color', 'never']);
  }
  async jobLog(target: HostingTarget, number: number, jobId: number) {
    const request = await this.read(target, number);
    if (!request.statusCheckRollup.some((check) => check.id === jobId))
      throw new Error('This job does not belong to the current request. Refresh the request.');
    return this.log(
      'gh',
      [
        'api',
        `repos/${target.targetProject}/actions/jobs/${jobId}/logs`,
        '--hostname',
        target.host,
      ],
      target,
    );
  }
  async comments(target: HostingTarget, number: number, page: number) {
    const raw = await this.call(target, ['pr', 'view', String(number), '--json', 'comments']);
    const value = z
      .object({
        comments: z.array(
          z.object({ id: z.string(), author, body: z.string(), createdAt: z.string() }),
        ),
      })
      .parse(JSON.parse(raw));
    return pageOf(value.comments, page);
  }
  async timeline(target: HostingTarget, number: number, page: number) {
    const raw = await this.call(target, [
      'pr',
      'view',
      String(number),
      '--json',
      'commits,reviews',
    ]);
    const value = z
      .object({
        commits: z.array(
          z.object({ oid: z.string(), messageHeadline: z.string(), committedDate: z.string() }),
        ),
        reviews: z.array(
          z.object({
            id: z.string(),
            author,
            state: z.string(),
            body: z.string(),
            submittedAt: z.string().nullable(),
          }),
        ),
      })
      .parse(JSON.parse(raw));
    return pageOf(
      [
        ...value.commits.map((item) => ({
          id: item.oid,
          title: 'Commit',
          body: '',
          date: item.committedDate,
          commits: [{ sha: item.oid, title: item.messageHeadline }],
        })),
        ...value.reviews.map((item) => ({
          id: item.id,
          title: `${item.author?.login ?? 'Reviewer'} · ${item.state}`,
          body: item.body,
          date: item.submittedAt ?? '',
        })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
      page,
    );
  }
  async create(target: HostingTarget, input: CreatePullRequest) {
    const head =
      target.sourceProject === target.targetProject
        ? input.head
        : `${target.sourceProject.split('/')[0]}:${input.head}`;
    const raw = await this.call(
      target,
      [
        'pr',
        'create',
        '--head',
        head,
        '--base',
        input.base,
        '--title',
        input.title,
        '--body-file',
        '-',
        ...(input.draft ? ['--draft'] : []),
      ],
      input.body,
    );
    const url = new URL(raw.trim());
    const number = Number(url.pathname.match(/\/pull\/(\d+)$/)?.[1]);
    if (url.host !== target.host || !Number.isSafeInteger(number) || number <= 0)
      throw new Error(
        'Unexpected pull request creation response. Inspect the repository before retrying.',
      );
    return { url: url.toString(), ref: requestRef(target, number) };
  }
  async update(target: HostingTarget, number: number, changes: PullRequestChanges) {
    const args = [
      'pr',
      'edit',
      String(number),
      ...(changes.title !== undefined ? ['--title', changes.title] : []),
      ...(changes.baseRefName !== undefined ? ['--base', changes.baseRefName] : []),
      ...(changes.body !== undefined ? ['--body-file', '-'] : []),
    ];
    if (Object.keys(changes).some((key) => key !== 'draft'))
      await this.call(target, args, changes.body);
    if (changes.draft !== undefined)
      await this.call(target, [
        'pr',
        'ready',
        String(number),
        ...(changes.draft ? ['--undo'] : []),
      ]);
  }
  async comment(target: HostingTarget, number: number, body: string) {
    await this.call(target, ['pr', 'comment', String(number), '--body-file', '-'], body);
  }
}
