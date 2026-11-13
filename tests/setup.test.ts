import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { temp } from './fixtures';

for (const scenario of [
  {
    name: 'recovers from a temporary Electron download failure',
    errors: ['HTTPError: Response code 504 ()'],
    attempts: 2,
    status: 0,
  },
  {
    name: 'limits failed Electron download attempts',
    errors: Array.from({ length: 3 }, () => 'HTTPError: Response code 503 ()'),
    attempts: 3,
    status: 1,
  },
  {
    name: 'does not retry a missing Electron release',
    errors: ['HTTPError: Response code 404 ()'],
    attempts: 1,
    status: 1,
  },
  {
    name: 'does not retry an Electron checksum failure',
    errors: ['Error: SHA256 checksum mismatch'],
    attempts: 1,
    status: 1,
  },
]) {
  test(`setup ${scenario.name}`, async () => {
    const directory = await temp();
    try {
      await copyFile(
        new URL('../scripts/setup.mjs', import.meta.url),
        join(directory, 'setup.mjs'),
      );
      await copyFile(
        new URL('../scripts/download.ts', import.meta.url),
        join(directory, 'download.ts'),
      );
      await writeFile(join(directory, 'ty.mjs'), 'export async function installTy() {}');
      await writeFile(join(directory, 'ruff.mjs'), 'export async function installRuff() {}');
      await writeFile(join(directory, 'zoekt.mjs'), 'export async function copyZoekt() {}');
      const electron = join(directory, 'node_modules/electron');
      await mkdir(electron, { recursive: true });
      await writeFile(join(directory, 'errors.json'), JSON.stringify(scenario.errors));
      await writeFile(join(directory, 'attempts'), '0');
      await writeFile(
        join(electron, 'install.js'),
        `const fs = require('node:fs');
const attempt = Number(fs.readFileSync('attempts', 'utf8'));
fs.writeFileSync('attempts', String(attempt + 1));
const error = JSON.parse(fs.readFileSync('errors.json', 'utf8'))[attempt];
if (error) { console.error(error); process.exit(1); }
`,
      );
      const pty = join(directory, 'node_modules/node-pty');
      const prebuild = join(pty, 'prebuilds', `${process.platform}-${process.arch}`);
      await mkdir(prebuild, { recursive: true });
      await writeFile(join(pty, 'package.json'), '{}');
      await writeFile(join(prebuild, 'spawn-helper'), '');
      const child = spawn(process.execPath, ['setup.mjs'], { cwd: directory });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
      });
      const [status] = await once(child, 'close');
      assert.equal(status, scenario.status, stderr);
      assert.equal(Number(await readFile(join(directory, 'attempts'), 'utf8')), scenario.attempts);
      assert.ok(stderr.includes(scenario.errors[0]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
