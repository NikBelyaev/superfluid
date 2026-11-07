import test from 'node:test';
import assert from 'node:assert/strict';
import { GitLabProvider } from './GitLabProvider';
import type { HostingTarget, RunHosting } from './HostingProvider';
import { gitlabRequest } from '../../../../tests/hostingFixtures';

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
  const provider = new GitLabProvider(async (_file, args) => {
    if (args[0] === 'repo') return JSON.stringify({ id: 11, default_branch: 'develop' });
    if (args[1] === 'list')
      return JSON.stringify([gitlabRequest, { ...gitlabRequest, iid: 43, source_project_id: 99 }]);
    return JSON.stringify(gitlabRequest);
  });
  const request = await provider.read(target, 42);
  assert.equal(request.ref.number, 42);
  assert.equal(request.changedFiles, '1000+');
  assert.equal(request.additions, null);
  assert.equal(request.body, gitlabRequest.description);
  const found = await provider.list(target, { state: 'open', page: 1, branch: 'main' });
  assert.deepEqual(
    found.items.map((item) => item.number),
    [42],
  );
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
