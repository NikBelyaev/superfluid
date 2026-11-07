import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { temp } from '../../../../tests/fixtures';
import { DesktopUpdates } from './DesktopUpdates';
import { WORKSPACE_DATA_VERSION } from '@superfluid/contracts';

class Updater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  channel: string | null = null;
  allowPrerelease = true;
  allowDowngrade = true;
  currentVersion = { compare: (_version: string) => (this.older ? 1 : -1) };
  older = false;
  checks = 0;
  downloads = 0;
  installs = 0;
  info = {
    version: '0.1.1',
    superfluidDataVersion: WORKSPACE_DATA_VERSION,
    releaseNotes: 'A fix.',
  };
  check = async () => {
    this.emit('update-available', this.info);
  };
  async checkForUpdates() {
    this.checks++;
    await this.check();
    return null;
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit('download-progress', { percent: 35.8 });
    this.emit('download-progress', { percent: 35.9 });
    this.emit('update-downloaded', this.info);
    return [];
  }
  quitAndInstall() {
    this.installs++;
  }
}

test('updates are explicit, serialized, and a postponed restart keeps the download', async () => {
  const directory = await temp();
  const updater = new Updater();
  const states: string[] = [];
  let resume!: (value: boolean) => void;
  let entered!: () => void;
  const enteredQuit = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const updates = new DesktopUpdates(
    updater,
    '0.1.0',
    directory,
    '',
    (s) => states.push(`${s.status}:${s.progress}`),
    async () => {
      entered();
      return new Promise<boolean>((resolve) => {
        resume = resolve;
      });
    },
  );
  await updates.initialize();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.channel, 'latest');
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal((await updates.run({ action: 'check' })).status, 'available');
  assert.equal(updater.downloads, 0);
  assert.equal((await updates.run({ action: 'download' })).status, 'downloaded');
  assert.equal(states.filter((s) => s === 'downloading:35').length, 1);
  const before = updater.checks;
  await updates.run({ action: 'check' }, true);
  assert.equal(updater.checks, before);
  const pending = updates.run({ action: 'install' });
  await enteredQuit;
  assert.equal(
    JSON.parse(await readFile(join(directory, 'desktop-updates.json'), 'utf8')).install.target,
    '0.1.1',
  );
  await assert.rejects(
    updates.run({ action: 'channel', channel: 'nightly' }),
    /already in progress/,
  );
  resume(false);
  assert.equal((await pending).status, 'downloaded');
  assert.equal(updater.installs, 0);
  assert.equal(
    JSON.parse(await readFile(join(directory, 'desktop-updates.json'), 'utf8')).install,
    undefined,
  );
  updater.info.version = '0.1.1-nightly.20261107.1';
  const switched = await updates.run({ action: 'channel', channel: 'nightly' });
  assert.equal(switched.channel, 'nightly');
  assert.equal(switched.status, 'available');
  assert.equal(switched.availableVersion, updater.info.version);
  await assert.rejects(updates.run({ action: 'install' }), /Download an update/);
  assert.equal(updater.installs, 0);
});

test('track changes persist and incompatible downgrades and wrong-channel releases cannot download', async () => {
  const directory = await temp();
  const updater = new Updater();
  updater.older = true;
  updater.info.superfluidDataVersion = 999;
  const updates = new DesktopUpdates(
    updater,
    '0.1.2-nightly.20261107.1',
    directory,
    '',
    () => {},
    async () => true,
  );
  await updates.initialize();
  assert.equal(updater.channel, 'nightly');
  const state = await updates.run({ action: 'channel', channel: 'stable' });
  assert.equal(updater.channel, 'latest');
  assert.equal(updater.allowDowngrade, true);
  assert.equal(state.availableVersion, null);
  assert.match(state.message, /compatibility/);
  await assert.rejects(updates.run({ action: 'download' }), /Check for an available update/);
  assert.equal(updater.downloads, 0);
  updater.info.superfluidDataVersion = WORKSPACE_DATA_VERSION;
  assert.equal((await updates.run({ action: 'check' })).status, 'available');
  updater.info.version = '0.1.2-nightly.20261107.2';
  const mismatch = await updates.run({ action: 'check' });
  assert.equal(mismatch.availableVersion, null);
  assert.match(mismatch.message, /selected update track/);
  const reopened = new DesktopUpdates(
    new Updater(),
    '0.1.2-nightly.20261107.1',
    directory,
    '',
    () => {},
    async () => true,
  );
  await reopened.initialize();
  assert.equal(reopened.snapshot.channel, 'stable');
});

test('a failed check can retry and a failed installation requires an explicit retry', async () => {
  const directory = await temp();
  const updater = new Updater();
  let fail = true;
  updater.check = async () => {
    if (fail) {
      updater.emit('error', new Error('Offline'));
      throw new Error('Offline');
    }
    updater.emit('update-available', updater.info);
  };
  const updates = new DesktopUpdates(
    updater,
    '0.1.0',
    directory,
    '',
    () => {},
    async (install) => {
      install();
      return true;
    },
  );
  await updates.initialize();
  assert.equal((await updates.run({ action: 'check' })).message, 'Offline');
  fail = false;
  await updates.run({ action: 'check' });
  await updates.run({ action: 'download' });
  await updates.run({ action: 'install' });
  const reopened = new DesktopUpdates(
    updater,
    '0.1.0',
    directory,
    '',
    () => {},
    async () => true,
  );
  await reopened.initialize();
  assert.match(reopened.snapshot.message, /did not apply/);
  const checks = updater.checks;
  await reopened.run({ action: 'check' }, true);
  assert.equal(updater.checks, checks);
  assert.equal((await reopened.run({ action: 'check' })).status, 'available');
  await writeFile(
    join(directory, 'desktop-updates.json'),
    JSON.stringify({ channel: 'stable', install: { from: '0.1.0', target: '0.1.1' } }),
  );
  const installed = new DesktopUpdates(
    new Updater(),
    '0.1.1',
    directory,
    '',
    () => {},
    async () => true,
  );
  await installed.initialize();
  assert.equal(installed.snapshot.status, 'idle');
  assert.equal(
    JSON.parse(await readFile(join(directory, 'desktop-updates.json'), 'utf8')).install,
    undefined,
  );
});

test('development builds and corrupt settings do not make network requests', async () => {
  const directory = await temp();
  await writeFile(join(directory, 'desktop-updates.json'), '{broken');
  const updater = new Updater();
  const updates = new DesktopUpdates(
    updater,
    '0.1.0',
    directory,
    'Development build',
    () => {},
    async () => true,
  );
  await updates.initialize();
  updates.start();
  await updates.run({ action: 'check' });
  assert.equal(updater.checks, 0);
  assert.equal(updates.snapshot.status, 'disabled');
  await updates.run({ action: 'channel', channel: 'nightly' });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'desktop-updates.json'), 'utf8')), {
    channel: 'nightly',
  });
  updates.stop();
});
