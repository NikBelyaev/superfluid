import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProvider } from './GitHubProvider';
import type { HostingTarget } from './HostingProvider';

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
