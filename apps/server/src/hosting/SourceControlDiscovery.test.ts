import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceControlDiscovery, parseSourceControlAccounts } from './SourceControlDiscovery';
import { ProcessError } from '../process/ProcessRunner';

test('source control discovery projects CLI accounts without returning credentials', () => {
  const github = parseSourceControlAccounts(
    'github',
    JSON.stringify({
      hosts: {
        'github.com': [
          { login: 'active', state: 'success', active: true, token: 'secret-token' },
          { login: 'expired', state: 'error', active: false, error: 'secret-token' },
        ],
      },
    }),
  );
  assert.deepEqual(github, [
    { host: 'github.com', login: 'active', authenticated: true, active: true },
    { host: 'github.com', login: 'expired', authenticated: false, active: false },
  ]);
  const gitlab = parseSourceControlAccounts(
    'gitlab',
    JSON.stringify({
      hosts: [
        {
          host: 'git.company.test:8443',
          user: 'enterprise',
          state: 'success',
          token: 'secret-token',
        },
        { host: 'gitlab.com', state: 'error', error: 'secret-token' },
      ],
    }),
  );
  assert.equal(gitlab[0].login, 'enterprise');
  assert.equal(gitlab[1].authenticated, false);
  assert.ok(!JSON.stringify({ github, gitlab }).includes('secret-token'));
});

test('discovery shares an active scan and reports missing tools and partially valid accounts', async () => {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const discovery = new SourceControlDiscovery('/fixture', async (file, args) => {
    calls.push(`${file}:${args[0]}`);
    if (file === 'git') {
      await blocked;
      return 'git version 2.50.1 (Apple Git-155)';
    }
    if (file === 'glab') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    if (args[0] === '--version') return 'gh version 2.80.0 (2026-01-01)';
    throw new ProcessError(
      'One host failed',
      1,
      JSON.stringify({
        hosts: {
          'github.com': [{ login: 'developer', active: true, state: 'success' }],
          'github.company.test': [{ login: 'expired', active: true, state: 'error' }],
        },
      }),
    );
  });
  const first = discovery.scan();
  assert.equal(discovery.scan(), first);
  assert.ok(release);
  release();
  const result = await first;
  assert.equal(calls.length, 4);
  assert.equal(result.versionControlSystems[0].version, '2.50.1');
  assert.equal(result.sourceControlProviders[0].auth, 'authenticated');
  assert.equal(result.sourceControlProviders[0].accounts.length, 2);
  assert.equal(result.sourceControlProviders[1].status, 'missing');
  await discovery.scan();
  assert.equal(calls.length, 8);
});

test('unsupported or malformed authentication output stays an explicit safe error', async () => {
  const discovery = new SourceControlDiscovery('/fixture', async (file, args) => {
    if (args[0] === '--version')
      return `${file === 'git' ? 'git version' : file === 'gh' ? 'gh version' : 'glab'} 1.2.3`;
    return '{"token":"do-not-expose"}';
  });
  const result = await discovery.scan();
  assert.ok(result.sourceControlProviders.every((tool) => tool.auth === 'unknown'));
  assert.ok(!JSON.stringify(result).includes('do-not-expose'));
});
