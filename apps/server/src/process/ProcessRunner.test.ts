import test from 'node:test';
import assert from 'node:assert/strict';
import { command } from './ProcessRunner';

test('command output preserves UTF-8 across chunk boundaries', async () => {
  const text = await command(
    process.execPath,
    [
      '-e',
      'const b=Buffer.from("Привет");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)',
    ],
    { cwd: process.cwd() },
  );
  assert.equal(text, 'Привет');
});
