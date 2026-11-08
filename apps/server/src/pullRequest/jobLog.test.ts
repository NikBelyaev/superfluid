import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJobLog } from './jobLog';

test('job logs strip terminal escapes and section markers and keep a bounded tail', () => {
  assert.deepEqual(
    formatJobLog(
      '\x1b[0Ksection_start:123:script\r\x1b[0K\x1b[31mFailed\x1b[0m\r\n<script>plain text</script>',
    ),
    { text: 'Failed\n<script>plain text</script>', truncated: false },
  );
  const log = formatJobLog('x'.repeat(300000) + '\nerror at the end');
  assert.equal(log.text.length, 256 * 1024);
  assert.equal(log.truncated, true);
  assert.ok(log.text.endsWith('error at the end'));
  const unicode = formatJobLog('🙂'.repeat(100000) + 'tail');
  assert.ok(Buffer.byteLength(unicode.text) <= 256 * 1024);
  assert.ok(!unicode.text.includes('\ufffd'));
  assert.deepEqual(formatJobLog('short tail', true), { text: 'short tail', truncated: true });
});
