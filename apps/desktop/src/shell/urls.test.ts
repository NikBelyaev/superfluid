import test from 'node:test';
import assert from 'node:assert/strict';
import { externalUrl, httpUrl } from './urls';

test('external links allow only HTTP URLs and scoped agent conversations', () => {
  const thread = '11111111-1111-4111-8111-111111111111';
  assert.equal(externalUrl(`codex://threads/${thread}`), `codex://threads/${thread}`);
  assert.equal(externalUrl('https://example.com'), 'https://example.com/');
  assert.equal(
    externalUrl('t3code://threads/env-1/thread%3A1'),
    't3code://threads/env-1/thread%3A1',
  );
  for (const url of [
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'javascript:alert(1)',
    'codex://settings',
    'codex://threads/not-a-uuid',
    't3code://new?prompt=run',
    't3code://threads/env-1/thread-1?prompt=run',
    't3code://threads/env-1/thread-1/extra',
    't3code://threads/env-1/thread%2F1',
    't3code://user@threads/env-1/thread-1',
    `codex://threads/${thread}?command=run`,
    `codex://user@threads/${thread}`,
    `codex://threads/${thread}/extra`,
  ])
    assert.throws(() => externalUrl(url));
  assert.throws(() => httpUrl(`codex://threads/${thread}`));
});
