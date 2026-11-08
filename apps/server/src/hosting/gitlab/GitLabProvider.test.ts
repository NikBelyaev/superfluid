import test from 'node:test';
import assert from 'node:assert/strict';
import { GitLabProvider } from './GitLabProvider';
import type { HostingTarget, RunHosting } from '../HostingProvider';
import { gitlabRequest } from '../../../../../tests/hostingFixtures';
import { repository } from '../../../../../tests/fixtures';
import { git } from '../../vcs/gitCommand';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { summarizePullRequestChecks } from '@superfluid/contracts';

const target: HostingTarget = {
  provider: 'gitlab',
  host: 'gitlab.example.test',
  sourceProject: 'people/fluid/editor',
  targetProject: 'platform/editor',
  remote: 'origin',
  branch: 'main',
  defaultBranch: 'develop',
  revision: 'fixture',
  cwd: '/fixture',
  remoteUrl: 'git@ssh.example.test:people/fluid/editor.git',
};

test('GitLab CLI preserves project-local iid, partial statistics and discussions', async () => {
  const calls: string[][] = [];
  const provider = new GitLabProvider(async (_file, args) => {
    calls.push(args);
    if (args[0] === 'repo') return JSON.stringify({ id: 11, default_branch: 'develop' });
    if (args[1] === 'list')
      return JSON.stringify([
        { ...gitlabRequest, head_pipeline: null },
        { ...gitlabRequest, iid: 43, source_project_id: 99 },
      ]);
    return JSON.stringify(gitlabRequest);
  });
  const request = await provider.read(target, 42);
  assert.equal(request.ref.number, 42);
  assert.equal(request.changedFiles, '1000+');
  assert.equal(request.additions, null);
  assert.equal(request.body, gitlabRequest.description);
  calls.length = 0;
  const found = await provider.list(target, { state: 'open', page: 1, branch: 'main' });
  assert.deepEqual(
    found.items.map((item) => item.number),
    [42],
  );
  assert.deepEqual(found.items[0].statusCheckRollup, []);
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((args) => args[1] === 'view' && args[0] === 'mr'));
  calls.length = 0;
  await provider.list(
    { ...target, sourceProjectId: 11 },
    { state: 'open', page: 1, branch: 'main' },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(
    (await provider.comments(target, 42, 1)).items.map((item) => item.id),
    ['101'],
  );
  assert.deepEqual(
    (await provider.timeline(target, 42, 1)).items.map((item) => item.body),
    ['added 2 commits'],
  );
});

test('GitLab writes send descriptions through stdin and leave Git push to publication', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const run: RunHosting = async (file, args, _target, input) => {
    assert.equal(file, 'glab');
    calls.push({ args, input });
    return args[1] === 'create' ? gitlabRequest.web_url : JSON.stringify(gitlabRequest);
  };
  const provider = new GitLabProvider(run);
  const body = 'A multiline\nbody with `quotes`, $(commands), @files and Unicode: привет';
  await provider.create(target, {
    title: 'Enterprise',
    body,
    draft: true,
    head: 'main',
    base: 'develop',
  });
  assert.equal(calls[0].input, body);
  assert.ok(calls[0].args.includes('--push=false'));
  assert.ok(calls[0].args.includes('--draft'));
  assert.ok(calls[0].args.includes('https://gitlab.example.test/people/fluid/editor'));
  await provider.update(target, 42, { body: '', draft: false });
  const update = calls.find((call) => call.args[1] === 'update');
  assert.ok(!update?.args.includes('--description-file'));
  assert.ok(update?.args.includes('--ready'));
  assert.ok(!update?.args.includes('--title'));
  await provider.comment(target, 42, body);
  assert.equal(calls.at(-1)?.input, body);
  assert.ok(calls.every((call) => !call.args.includes(body)));
  const clear = calls.filter((call) => call.args[0] === 'api');
  assert.equal(clear.length, 1);
  assert.equal(clear[0].input, '{"description":""}');
  assert.ok(clear[0].args.includes('projects/platform%2Feditor/merge_requests/42'));
});

test('GitLab rejects malformed responses and keeps pagination after filtering forks', async () => {
  const malformed = new GitLabProvider(async () => JSON.stringify({ ...gitlabRequest, iid: '42' }));
  await assert.rejects(() => malformed.read(target, 42));
  const provider = new GitLabProvider(async (_file, args) =>
    args[0] === 'repo'
      ? '{"id":11}'
      : JSON.stringify(
          Array.from({ length: 30 }, () => ({ ...gitlabRequest, source_project_id: 99 })),
        ),
  );
  const page = await provider.list(target, { state: 'open', page: 2, branch: 'main' });
  assert.equal(page.items.length, 0);
  assert.equal(page.hasMore, true);
});

test('GitLab reads line statistics and the actual pipeline status with its URL', async () => {
  const provider = new GitLabProvider(async (_file, args) =>
    args[0] === 'api'
      ? JSON.stringify({
          data: {
            project: { mergeRequest: { diffStatsSummary: { additions: 1394, deletions: 544 } } },
          },
        })
      : JSON.stringify({
          ...gitlabRequest,
          head_pipeline: {
            name: '',
            status: 'failed',
            sha: gitlabRequest.sha,
            web_url: 'https://gitlab.example.test/platform/editor/-/pipelines/12',
          },
        }),
  );
  const request = await provider.read(target, 42);
  assert.equal(request.additions, 1394);
  assert.equal(request.deletions, 544);
  assert.deepEqual(request.statusCheckRollup, [
    {
      kind: 'pipeline',
      name: 'Pipeline',
      state: 'FAILED',
      url: 'https://gitlab.example.test/platform/editor/-/pipelines/12',
    },
  ]);
  const stale = new GitLabProvider(async () =>
    JSON.stringify({ ...gitlabRequest, head_pipeline: { status: 'failed', sha: 'b'.repeat(40) } }),
  );
  assert.deepEqual((await stale.read(target, 42)).statusCheckRollup, []);
});

test('GitLab falls back to local line statistics when GraphQL reports no statistics', async () => {
  const cwd = await repository();
  const base_sha = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(cwd, 'main.py'), 'print("changed")\nprint("more")\n');
  await git(cwd, ['commit', '-am', 'Change']);
  const head_sha = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  const provider = new GitLabProvider(async (_file, args) =>
    JSON.stringify(
      args[0] === 'api'
        ? { data: { project: { mergeRequest: { diffStatsSummary: null } } } }
        : { ...gitlabRequest, diff_refs: { base_sha, head_sha } },
    ),
  );
  const request = await provider.read({ ...target, cwd }, 42);
  assert.equal(request.additions, 2);
  assert.equal(request.deletions, 1);
});

test('GitLab commit patches request the selected commit and reject truncated diffs', async () => {
  let truncated = false;
  const provider = new GitLabProvider(async (_file, args) => {
    assert.ok(
      args.includes(
        'projects/platform%2Feditor/repository/commits/6e8d826d/diff?per_page=100&page=1',
      ),
    );
    return JSON.stringify([
      {
        old_path: 'new file.py',
        new_path: 'new file.py',
        new_file: true,
        deleted_file: false,
        diff: '@@ -0,0 +1 @@\n+print("commit")\n',
        too_large: truncated,
      },
    ]);
  });
  const patch = await provider.patch(target, 42, '6e8d826d');
  assert.match(patch, /--- \/dev\/null\n\+\+\+ "b\/new file.py"\n/);
  assert.match(patch, /\+print\("commit"\)/);
  truncated = true;
  await assert.rejects(provider.patch(target, 42, '6e8d826d'), /truncated/);
});

test('GitLab commit notes expose commit links without rendering raw HTML', async () => {
  const provider = new GitLabProvider(async () =>
    JSON.stringify({
      Discussions: [
        {
          id: 'commits',
          notes: [
            {
              id: 401,
              author: { username: 'dev' },
              created_at: '2026-11-07',
              system: true,
              body: 'added 1 commit\n\n<ul><li>21239da4...48a1e2a3 - 6 commits from branch <code>master</code></li><li>6e8d826d - Fix &lt;title&gt; &amp; state &#128512; &#x110000;</li></ul>\n\n[Compare with previous version](/group/project/-/merge_requests/42/diffs)',
            },
          ],
        },
      ],
    }),
  );
  const result = await provider.timeline(target, 42, 1);
  assert.equal(result.items[0].action, 'added 1 commit');
  assert.deepEqual(result.items[0].commits, [
    { sha: '6e8d826d', title: 'Fix <title> & state 😀 &#x110000;' },
  ]);
  assert.match(result.items[0].body, /- 21239da4\.\.\.48a1e2a3 - 6 commits from branch master/);
  assert.ok(!result.items[0].body.includes('<ul>'));
  assert.ok(!result.items[0].body.includes('<li>'));
});

test('GitLab CI reads all current pipeline jobs in stage order and loads only the selected log', async () => {
  const calls: string[][] = [];
  const value = {
    ...gitlabRequest,
    head_pipeline: { id: 12, project_id: 11, status: 'failed', sha: gitlabRequest.sha },
  };
  const job = {
    id: 21,
    name: 'tests',
    status: 'failed',
    stage: 'test',
    web_url: 'https://gitlab.example.test/people/fluid/editor/-/jobs/21',
    started_at: '2026-11-07T12:00:00Z',
    finished_at: '2026-11-07T12:00:09Z',
    duration: 9,
    allow_failure: false,
    pipeline: { id: 12 },
  };
  const provider = new GitLabProvider(async (_file, args) => {
    calls.push(args);
    if (args[1]?.endsWith('/trace')) return 'job output';
    if (args[1]?.includes('/jobs/21')) return JSON.stringify(job);
    if (args[1]?.includes('/pipelines/12/jobs'))
      return JSON.stringify([
        job,
        { ...job, id: 20, name: 'compile', stage: 'build', status: 'success' },
      ]);
    return JSON.stringify(value);
  });
  const request = await provider.read(target, 42);
  assert.deepEqual(
    request.statusCheckRollup.map((check) => [check.id, check.name, check.stage, check.state]),
    [
      [20, 'compile', 'build', 'SUCCESS'],
      [21, 'tests', 'test', 'FAILED'],
    ],
  );
  assert.equal(request.statusCheckRollup[1].duration, 9);
  for (const [status, state] of [
    ['running', 'pending'],
    ['pending', 'pending'],
    ['manual', 'blocked'],
    ['canceled', 'skipped'],
  ]) {
    const downstream = new GitLabProvider(async (_file, args) =>
      JSON.stringify(
        args[1]?.includes('/pipelines/')
          ? [{ ...job, status: 'success' }]
          : { ...value, head_pipeline: { ...value.head_pipeline, status } },
      ),
    );
    const checks = await downstream.checks(target, 42);
    assert.equal(summarizePullRequestChecks(checks.statusCheckRollup).state, state);
    assert.equal(summarizePullRequestChecks(checks.statusCheckRollup).total, 1);
  }
  calls.length = 0;
  const checks = await provider.checks(target, 42);
  assert.equal(checks.headRefOid, gitlabRequest.sha);
  assert.deepEqual(checks.statusCheckRollup, request.statusCheckRollup);
  assert.ok(!calls.some((args) => args[1] === 'graphql' || args[1] === 'diff'));
  assert.ok(!calls.some((args) => args[1]?.endsWith('/trace')));
  assert.deepEqual(await provider.jobLog(target, 42, 21), { text: 'job output', truncated: false });
  assert.ok(calls.some((args) => args[1] === 'projects/11/jobs/21/trace'));
  const foreign = new GitLabProvider(async (_file, args) =>
    JSON.stringify(args[0] === 'mr' ? value : { ...job, pipeline: { id: 99 } }),
  );
  await assert.rejects(foreign.jobLog(target, 42, 21), /current pipeline/);
  const pages: string[] = [];
  const paginated = new GitLabProvider(async (_file, args) => {
    if (!args[1]?.includes('/pipelines/')) return JSON.stringify(value);
    pages.push(args[1]);
    return JSON.stringify(
      args[1].endsWith('page=1')
        ? Array.from({ length: 100 }, (_, index) => ({ ...job, id: index + 1, status: 'success' }))
        : [{ ...job, id: 101 }],
    );
  });
  assert.equal((await paginated.read(target, 42)).statusCheckRollup.length, 101);
  assert.equal(pages.length, 2);
  assert.ok(pages[1].endsWith('page=2'));
  const empty = new GitLabProvider(async (_file, args) =>
    JSON.stringify(args[1]?.includes('/pipelines/') ? [] : value),
  );
  assert.equal((await empty.read(target, 42)).statusCheckRollup[0].state, 'FAILED');
});

test('GitLab CI access failures preserve the pipeline status and explain the missing permission', async () => {
  const provider = new GitLabProvider(async (_file, args) => {
    if (args[1]?.includes('/pipelines/'))
      throw new Error('HTTP 403 insufficient_granular_scope Pipeline: Read');
    return JSON.stringify({
      ...gitlabRequest,
      head_pipeline: { id: 12, status: 'failed', sha: gitlabRequest.sha },
    });
  });
  const request = await provider.checks(target, 42);
  assert.equal(request.statusCheckRollup[0].state, 'FAILED');
  assert.match(request.checksError ?? '', /Pipeline: Read/);
  const denied = new GitLabProvider(async (_file, args) => {
    if (args[0] === 'api') throw new Error('HTTP 403');
    return JSON.stringify({ ...gitlabRequest, head_pipeline: { id: 12, status: 'failed' } });
  });
  await assert.rejects(denied.jobLog(target, 42, 21), /Job: Read/);
});

test('GitLab synthetic merge and train pipelines must contain the current source head', async () => {
  let parents = [gitlabRequest.sha];
  let ref = 'refs/merge-requests/42/merge';
  const pipeline = {
    id: 12,
    project_id: 11,
    status: 'running',
    sha: 'b'.repeat(40),
    source: 'merge_request_event',
  };
  const provider = new GitLabProvider(async (_file, args) => {
    if (args[0] === 'mr')
      return JSON.stringify({ ...gitlabRequest, head_pipeline: { ...pipeline, ref } });
    if (args[1]?.includes('/repository/commits/'))
      return JSON.stringify({ id: pipeline.sha, parent_ids: parents });
    if (args[1]?.endsWith('/trace')) return 'synthetic output';
    if (args[1]?.endsWith('/jobs/21'))
      return JSON.stringify({
        id: 21,
        name: 'tests',
        status: 'running',
        stage: 'test',
        web_url: 'https://gitlab.example.test/jobs/21',
        pipeline: { id: 12 },
      });
    return '[]';
  });
  for (ref of ['refs/merge-requests/42/merge', 'refs/merge-requests/42/train']) {
    assert.equal((await provider.checks(target, 42)).statusCheckRollup[0]?.state, 'RUNNING');
    assert.deepEqual(await provider.jobLog(target, 42, 21), {
      text: 'synthetic output',
      truncated: false,
    });
  }
  parents = ['c'.repeat(40)];
  assert.deepEqual((await provider.checks(target, 42)).statusCheckRollup, []);
  await assert.rejects(provider.jobLog(target, 42, 21), /current pipeline/);
  parents = [gitlabRequest.sha];
  ref = 'refs/merge-requests/43/merge';
  assert.deepEqual((await provider.checks(target, 42)).statusCheckRollup, []);
});

test('GitLab merge state respects project strategy, squash policy, permissions and merge blockers', async () => {
  const value = {
    ...gitlabRequest,
    detailed_merge_status: 'ci_must_pass',
    user: { can_merge: true },
    merge_when_pipeline_succeeds: false,
    squash_on_merge: true,
    has_conflicts: false,
  };
  const settings = { merge_method: 'merge', squash_option: 'default_on' };
  const provider = new GitLabProvider(async (_file, args) =>
    JSON.stringify(args[0] === 'repo' ? settings : value),
  );
  const waiting = await provider.mergeState(target, 42);
  assert.deepEqual(waiting.methods, ['merge', 'squash']);
  assert.equal(waiting.defaultMethod, 'squash');
  assert.equal(waiting.canMerge, false);
  assert.equal(waiting.canAutoMerge, true);
  assert.match(waiting.reason ?? '', /checks/i);
  value.detailed_merge_status = 'mergeable';
  assert.equal((await provider.mergeState(target, 42)).canMerge, true);
  settings.squash_option = 'always';
  assert.deepEqual((await provider.mergeState(target, 42)).methods, ['squash']);
  settings.squash_option = 'never';
  settings.merge_method = 'ff';
  assert.deepEqual((await provider.mergeState(target, 42)).methods, ['rebase']);
  value.has_conflicts = true;
  assert.equal((await provider.mergeState(target, 42)).canAutoMerge, false);
  value.has_conflicts = false;
  value.user.can_merge = false;
  assert.equal((await provider.mergeState(target, 42)).canMerge, false);
});

test('GitLab merge writes pin the reviewed SHA and explicitly select squash and auto-merge', async () => {
  const calls: string[][] = [];
  const provider = new GitLabProvider(async (_file, args) => {
    calls.push(args);
    return '';
  });
  await provider.merge(target, 42, {
    action: 'merge',
    method: 'merge',
    expectedHeadSha: gitlabRequest.sha,
  });
  assert.ok(calls[0].includes('--auto-merge=false'));
  assert.ok(calls[0].includes('--squash=false'));
  assert.ok(calls[0].includes('--sha'));
  assert.ok(calls[0].includes(gitlabRequest.sha));
  await provider.merge(target, 42, {
    action: 'auto',
    method: 'squash',
    expectedHeadSha: gitlabRequest.sha,
  });
  assert.ok(calls[1].includes('--auto-merge=true'));
  assert.ok(calls[1].includes('--squash=true'));
  await provider.merge(target, 42, { action: 'cancel-auto', expectedHeadSha: gitlabRequest.sha });
  assert.ok(
    calls[2].includes(
      'projects/platform%2Feditor/merge_requests/42/cancel_merge_when_pipeline_succeeds',
    ),
  );
  assert.ok(
    calls.every((args) => !args.includes('--remove-source-branch') && !args.includes('--rebase')),
  );
});
