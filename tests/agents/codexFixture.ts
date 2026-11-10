import { existsSync, watch } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { command } from '../../apps/server/src/process/ProcessRunner';

export const codexThreadId = '11111111-1111-4111-8111-111111111111';

export async function createCodexFixture(home: string, cwd: string) {
  await mkdir(home, { recursive: true });
  const bin = join(dirname(home), 'bin');
  await mkdir(bin, { recursive: true });
  const callsFile = join(home, 'queue.jsonl');
  const hold = join(home, 'queue.hold');
  const held = join(home, 'queue.held');
  await writeFile(
    join(bin, 'codex'),
    '#!' +
      process.execPath +
      '\n' +
      `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'queue') process.exit(2);
if (args.includes('--message=fail')) { console.error('Unable to queue the fixture message'); process.exit(1); }
const finish = () => fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ args, cwd: process.cwd(), home: process.env.CODEX_HOME }) + '\\n');
if (fs.existsSync(${JSON.stringify(hold)})) {
  let done = false;
  const release = () => { if (done || fs.existsSync(${JSON.stringify(hold)})) return; done = true; watcher.close(); finish(); };
  const watcher = fs.watch(${JSON.stringify(home)}, release);
  fs.writeFileSync(${JSON.stringify(held)}, '');
  release();
} else finish();
`,
    { mode: 0o755 },
  );
  let turn = 'fixture-turn';
  const queueCalls = async (): Promise<{ args: string[]; cwd: string; home: string }[]> => {
    const text = await readFile(callsFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    return text.trim()
      ? text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  };
  return {
    bin,
    async send(name: string, input: Record<string, unknown> = {}) {
      if (name === 'UserPromptSubmit' && typeof input.turn_id === 'string') turn = input.turn_id;
      const config = JSON.parse(await readFile(join(home, 'hooks.json'), 'utf8'));
      const handler = config.hooks[name]
        .flatMap((group: { hooks: { command: string; statusMessage?: string }[] }) => group.hooks)
        .find(
          (hook: { statusMessage?: string }) => hook.statusMessage === 'Superfluid agent status',
        );
      if (!handler) throw new Error('Superfluid hook is missing for ' + name);
      const output = await command('/bin/sh', ['-c', handler.command], {
        cwd,
        env: { CODEX_HOME: home },
        input: JSON.stringify({
          session_id: codexThreadId,
          cwd,
          model: 'Codex fixture',
          turn_id: turn,
          hook_event_name: name,
          ...input,
        }),
      });
      return JSON.parse(output || '{}');
    },
    queueCalls,
    queueRecorded(message: string) {
      return new Promise<void>((resolve, reject) => {
        const check = async () => {
          try {
            if (!(await queueCalls()).some((call) => call.args.includes('--message=' + message)))
              return;
            watcher.close();
            resolve();
          } catch (error) {
            watcher.close();
            reject(error);
          }
        };
        const watcher = watch(home, () => {
          void check();
        });
        void check();
      });
    },
    async holdQueue() {
      await rm(held, { force: true });
      await writeFile(hold, '');
    },
    queueHeld() {
      return new Promise<void>((resolve) => {
        const check = () => {
          if (existsSync(held)) {
            watcher.close();
            resolve();
          }
        };
        const watcher = watch(home, check);
        check();
      });
    },
    async releaseQueue() {
      await rm(hold, { force: true });
    },
  };
}
