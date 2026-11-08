import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePullRequestChecks, pullRequestRequests } from './pullRequest';

test('CI summaries count failures, allow optional failures and preserve pending and canceled states', () => {
  for (const [checks, expected] of [
    [
      [
        { name: 'Tests', state: 'FAILED' },
        { name: 'Build', state: 'SUCCESS' },
      ],
      { state: 'failed', count: 1, total: 2 },
    ],
    [
      [
        { name: 'Tests', state: 'FAILED', allowFailure: true },
        { name: 'Build', state: 'RUNNING' },
      ],
      { state: 'pending', count: 1, total: 2 },
    ],
    [
      [{ name: 'Optional', state: 'FAILED', allowFailure: true }],
      { state: 'warning', count: 1, total: 1 },
    ],
    [
      [
        { name: 'Optional', state: 'FAILED', allowFailure: true },
        { name: 'Pipeline', state: 'SUCCESS', kind: 'pipeline' },
      ],
      { state: 'warning', count: 1, total: 1 },
    ],
    [[{ name: 'Deploy', state: 'MANUAL' }], { state: 'blocked', count: 1, total: 1 }],
    [
      [
        { name: 'Tests', state: 'SUCCESS' },
        { name: 'Deploy', state: 'MANUAL', allowFailure: true },
      ],
      { state: 'passed', count: 1, total: 2 },
    ],
    [[{ name: 'Tests', state: 'CANCELED' }], { state: 'skipped', count: 1, total: 1 }],
  ] as const)
    assert.deepEqual(summarizePullRequestChecks([...checks]), expected);
  assert.equal(
    pullRequestRequests['pr.jobLog'].safeParse({
      sessionId: 'test',
      ref: { provider: 'gitlab', host: 'gitlab.test', project: 'a/b', number: 1 },
      jobId: '../21',
    }).success,
    false,
  );
});
