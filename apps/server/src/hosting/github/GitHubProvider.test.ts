import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProvider } from './GitHubProvider';
import type { HostingTarget } from '../HostingProvider';
import { githubRequest } from '../../../../../tests/hostingFixtures';

test('GitHub fork metadata uses the parent name and owner returned by gh repo view', async () => {
  const target: HostingTarget = {
    provider: 'github',
    host: 'github.com',
    remote: 'origin',
    sourceProject: 'developer/editor',
    targetProject: 'developer/editor',
    branch: 'feature',
    defaultBranch: '',
    revision: 'fixture',
    cwd: '/fixture',
    remoteUrl: 'git@github.com:developer/editor.git',
  };
  const provider = new GitHubProvider(async () =>
    JSON.stringify({
      defaultBranchRef: { name: 'main' },
      parent: { id: 'parent', name: 'editor', owner: { id: 'owner', login: 'platform' } },
    }),
  );
  assert.deepEqual(await provider.repository(target), {
    defaultBranch: 'main',
    upstreamProject: 'platform/editor',
  });
});

test('GitHub preserves pending checks and requests a commit patch through the diff API', async () => {
  const target: HostingTarget = {
    provider: 'github',
    host: 'github.com',
    remote: 'origin',
    sourceProject: 'superfluid-tests/fluid-lab',
    targetProject: 'superfluid-tests/fluid-lab',
    branch: 'feature/parallel',
    defaultBranch: 'main',
    revision: 'fixture',
    cwd: '/fixture',
    remoteUrl: githubRequest.url,
  };
  const calls: string[][] = [];
  const provider = new GitHubProvider(async (_file, args) => {
    calls.push(args);
    return args[0] === 'api'
      ? 'commit patch'
      : JSON.stringify({
          ...githubRequest,
          statusCheckRollup: [
            { name: 'Tests', conclusion: '', status: 'IN_PROGRESS', detailsUrl: null },
            { context: 'Deploy', state: 'PENDING', targetUrl: '' },
          ],
        });
  });
  assert.deepEqual((await provider.read(target, 15)).statusCheckRollup, [
    { name: 'Tests', state: 'IN_PROGRESS' },
    { name: 'Deploy', state: 'PENDING' },
  ]);
  assert.equal(await provider.patch(target, 15, '6e8d826d'), 'commit patch');
  assert.ok(calls.at(-1)?.includes('repos/superfluid-tests/fluid-lab/commits/6e8d826d'));
  assert.ok(calls.at(-1)?.includes('Accept: application/vnd.github.diff'));
  const logs = new GitHubProvider(async (_file, args) => {
    calls.push(args);
    return args[0] === 'api'
      ? 'tests passed'
      : JSON.stringify({
          ...githubRequest,
          statusCheckRollup: [
            {
              name: 'Tests',
              conclusion: 'SUCCESS',
              detailsUrl: 'https://github.com/superfluid-tests/fluid-lab/actions/runs/123/job/456',
              startedAt: '2026-11-07T12:00:00Z',
              completedAt: '2026-11-07T12:01:00Z',
            },
          ],
        });
  });
  assert.equal((await logs.read(target, 15)).statusCheckRollup[0].id, 456);
  assert.deepEqual(await logs.jobLog(target, 15, 456), { text: 'tests passed', truncated: false });
  assert.ok(calls.at(-1)?.includes('repos/superfluid-tests/fluid-lab/actions/jobs/456/logs'));
  await assert.rejects(logs.jobLog(target, 15, 999), /current request/);
});

test('GitHub merge state and commands use allowed methods without bypassing host protections', async () => {
  const target: HostingTarget = {
    provider: 'github',
    host: 'github.com',
    sourceProject: 'team/editor',
    targetProject: 'team/editor',
    remote: 'origin',
    branch: 'feature',
    defaultBranch: 'main',
    revision: 'fixture',
    cwd: '/fixture',
    remoteUrl: 'https://github.com/team/editor.git',
  };
  const value = {
    state: 'OPEN',
    isDraft: false,
    headRefOid: githubRequest.headRefOid,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    autoMergeRequest: null,
    reviewDecision: 'REVIEW_REQUIRED',
  };
  const calls: string[][] = [];
  const provider = new GitHubProvider(async (_file, args) => {
    calls.push(args);
    return JSON.stringify(
      args[0] === 'api'
        ? {
            allow_merge_commit: false,
            allow_squash_merge: true,
            allow_rebase_merge: true,
            allow_auto_merge: true,
            permissions: { push: true },
          }
        : value,
    );
  });
  const blocked = await provider.mergeState(target, 15);
  assert.deepEqual(blocked.methods, ['squash', 'rebase']);
  assert.equal(blocked.canMerge, false);
  assert.equal(blocked.canAutoMerge, true);
  value.mergeStateStatus = 'CLEAN';
  value.reviewDecision = 'APPROVED';
  assert.equal((await provider.mergeState(target, 15)).canMerge, true);
  await provider.merge(target, 15, {
    action: 'auto',
    method: 'rebase',
    expectedHeadSha: githubRequest.headRefOid,
  });
  assert.ok(calls.at(-1)?.includes('--match-head-commit'));
  assert.ok(calls.at(-1)?.includes('--rebase'));
  assert.ok(calls.at(-1)?.includes('--auto'));
  assert.ok(calls.every((args) => !args.includes('--admin') && !args.includes('--delete-branch')));
});
