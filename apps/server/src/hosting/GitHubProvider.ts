import { z } from 'zod';
import { projectPath, type PullRequestChanges } from '@superfluid/contracts';
import {
  pageOf,
  pageSize,
  repositoryUrl,
  requestRef,
  type RunHosting,
  type HostingProvider,
  type HostingTarget,
  type PullRequestQuery,
  type CreatePullRequest,
} from './HostingProvider';

const author = z.object({ login: z.string() }).nullable();
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
});
const fields =
  'number,title,body,state,url,author,baseRefName,headRefName,headRefOid,isDraft,updatedAt,headRepository,headRepositoryOwner';
const details = summary.extend({
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  statusCheckRollup: z
    .array(
      z.object({
        name: z.string().optional(),
        context: z.string().optional(),
        conclusion: z.string().nullable().optional(),
        status: z.string().optional(),
        state: z.string().optional(),
      }),
    )
    .nullable(),
});

export class GitHubProvider implements HostingProvider {
  constructor(private run: RunHosting) {}
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
      fields + ',additions,deletions,changedFiles,statusCheckRollup',
    ]);
    const value = details.parse(JSON.parse(raw));
    return {
      ...this.normalize(target, value),
      additions: value.additions,
      deletions: value.deletions,
      changedFiles: String(value.changedFiles),
      statusCheckRollup: (value.statusCheckRollup ?? []).map((check) => ({
        name: check.name ?? check.context ?? 'Check',
        state: check.conclusion || check.status || check.state || 'UNKNOWN',
      })),
    };
  }
  patch(target: HostingTarget, number: number) {
    return this.call(target, ['pr', 'diff', String(number), '--color', 'never']);
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
          title: item.messageHeadline,
          body: item.oid.slice(0, 7),
          date: item.committedDate,
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
