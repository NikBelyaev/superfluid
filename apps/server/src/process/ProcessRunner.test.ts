import test from 'node:test';
import assert from 'node:assert/strict';
import { command, commandTail, ProcessError } from './ProcessRunner';

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

test('tail capture drains large output, preserves UTF-8 and keeps ordinary output and exit guards', async () => {
  const args = [
    '-e',
    "for(let n=0;n<80;n++)process.stdout.write('Ж'.repeat(32768));process.stdout.write('🙂 final marker');",
  ];
  const options = { cwd: process.cwd() };
  const result = await commandTail(process.execPath, args, options, 256 * 1024);
  assert.ok(result.truncated);
  assert.ok(Buffer.byteLength(result.text) <= 256 * 1024);
  assert.ok(result.text.endsWith('🙂 final marker'));
  assert.ok(!result.text.includes('\ufffd'));
  await assert.rejects(command(process.execPath, args, options), /too much data/);
  await assert.rejects(
    commandTail(
      process.execPath,
      ['-e', "process.stdout.write('tail');process.stderr.write('job failed');process.exitCode=2"],
      options,
      256,
    ),
    (error: unknown) =>
      error instanceof ProcessError &&
      error.code === 2 &&
      error.stdout === 'tail' &&
      error.message === 'job failed',
  );
});
