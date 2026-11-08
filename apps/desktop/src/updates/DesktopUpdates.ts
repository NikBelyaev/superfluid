import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppUpdater } from 'electron-updater';
import type { AppUpdaterEvents } from 'electron-updater/out/AppUpdater';
import { z } from 'zod';
import {
  updateChannel,
  WORKSPACE_DATA_VERSION,
  type UpdateChannel,
  type UpdateRequest,
  type UpdateState,
} from '@superfluid/contracts';

export type DesktopUpdater = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'channel'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
> & {
  currentVersion: { compare(version: string): number };
  on<K extends keyof AppUpdaterEvents>(event: K, listener: AppUpdaterEvents[K]): unknown;
};

const settingsSchema = z.object({
  channel: updateChannel,
  install: z.object({ from: z.string(), target: z.string() }).optional(),
});
const releaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-nightly\.\d{8}\.\d+)?$/),
  superfluidDataVersion: z.number().int().positive().optional(),
});

export const channelOf = (version: string): UpdateChannel =>
  version.includes('-nightly.') ? 'nightly' : 'stable';

export class DesktopUpdates {
  private state: UpdateState;
  private settings: z.infer<typeof settingsSchema>;
  private busy = false;
  private blockedVersion: string | undefined;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly updater: DesktopUpdater,
    version: string,
    private readonly directory: string,
    private readonly disabledReason: string,
    private readonly emit: (state: UpdateState) => void,
    private readonly quit: (install: () => void) => Promise<boolean>,
  ) {
    this.settings = { channel: channelOf(version) };
    this.state = {
      version,
      channel: this.settings.channel,
      status: disabledReason ? 'disabled' : 'idle',
      availableVersion: null,
      progress: null,
      releaseNotes: '',
      message: disabledReason,
    };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('error', (error) => this.fail(error));
    updater.on('update-available', (info) => {
      try {
        const release = releaseSchema.parse(info);
        if (channelOf(release.version) !== this.state.channel)
          throw new Error('The release does not belong to the selected update track.');
        if (release.version === this.blockedVersion) {
          this.set({
            status: 'error',
            message: 'The last update did not apply. Check for updates to retry.',
          });
          return;
        }
        if (
          updater.currentVersion.compare(release.version) > 0 &&
          release.superfluidDataVersion !== WORKSPACE_DATA_VERSION
        )
          throw new Error(
            'This older release cannot confirm compatibility with your workspace data. Stay on this track until a compatible release is available.',
          );
        const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
        this.set({
          status: 'available',
          availableVersion: release.version,
          releaseNotes: notes.slice(0, 16000),
          message: '',
          progress: null,
        });
      } catch (error) {
        this.set({ availableVersion: null });
        this.fail(error);
      }
    });
    updater.on('update-not-available', () => {
      if (this.state.status === 'checking')
        this.set({ status: 'idle', message: 'You are up to date.' });
    });
    updater.on('download-progress', ({ percent }) => {
      const progress = Math.max(0, Math.min(100, Math.floor(percent)));
      if (Number.isFinite(progress) && progress !== this.state.progress) this.set({ progress });
    });
    updater.on('update-downloaded', ({ version: downloaded }) => {
      if (this.state.status === 'downloading' && downloaded === this.state.availableVersion)
        this.set({ status: 'downloaded', progress: 100, message: '' });
    });
  }

  async initialize() {
    try {
      this.settings = settingsSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        this.fail(
          new Error('Could not read update settings. Select an update track to reset them.'),
        );
    }
    this.configureChannel();
    this.set({ channel: this.settings.channel });
    if (this.settings.install) {
      if (this.settings.install.from !== this.state.version) {
        delete this.settings.install;
        await this.save().catch((error) => this.fail(error));
      } else {
        this.blockedVersion = this.settings.install.target;
        this.fail(new Error('The last update did not apply. Check for updates to retry.'));
      }
    }
  }

  get snapshot() {
    return { ...this.state };
  }

  start() {
    if (this.disabledReason) return;
    const check = () => void this.run({ action: 'check' }, true).catch((error) => this.fail(error));
    this.timers.push(setTimeout(check, 15000), setInterval(check, 4 * 60 * 1000));
    for (const timer of this.timers) timer.unref();
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  async run(request: UpdateRequest, background = false): Promise<UpdateState> {
    if (request.action === 'state') return this.snapshot;
    if (this.busy) {
      if (background) return this.snapshot;
      throw new Error('An update operation is already in progress.');
    }
    if (this.state.status === 'installing') {
      if (background) return this.snapshot;
      throw new Error('The update is already restarting Superfluid.');
    }
    if (request.action === 'download' && this.state.status !== 'available')
      throw new Error('Check for an available update first.');
    if (
      request.action === 'install' &&
      (this.state.status !== 'downloaded' || !this.state.availableVersion)
    )
      throw new Error('Download an update before installing it.');
    if (
      background &&
      (this.blockedVersion || ['downloaded', 'installing'].includes(this.state.status))
    )
      return this.snapshot;
    this.busy = true;
    try {
      if (request.action === 'channel') {
        await this.save({ channel: request.channel });
        this.configureChannel();
        this.set({
          channel: request.channel,
          availableVersion: null,
          releaseNotes: '',
          progress: null,
        });
      }
      if (this.disabledReason) {
        this.set({ status: 'disabled', message: this.disabledReason });
        return this.snapshot;
      }
      if (request.action === 'check' || request.action === 'channel') {
        if (request.action === 'check' && this.state.status === 'downloaded') return this.snapshot;
        if (!background && this.blockedVersion) {
          this.blockedVersion = undefined;
          await this.save({ channel: this.settings.channel });
        }
        this.set({
          status: 'checking',
          message: '',
          availableVersion: null,
          releaseNotes: '',
          progress: null,
        });
        await this.updater.checkForUpdates();
      } else if (request.action === 'download') {
        this.set({ status: 'downloading', message: '', progress: 0 });
        await this.updater.downloadUpdate();
      } else if (request.action === 'install') {
        if (!this.state.availableVersion) return this.snapshot;
        await this.save({
          ...this.settings,
          install: { from: this.state.version, target: this.state.availableVersion },
        });
        this.set({ status: 'installing', message: '' });
        if (!(await this.quit(() => this.updater.quitAndInstall(false, true)))) {
          await this.save({ channel: this.settings.channel });
          this.set({ status: 'downloaded', message: 'Restart postponed. Your update is ready.' });
        }
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
    return this.snapshot;
  }

  private get file() {
    return join(this.directory, 'desktop-updates.json');
  }

  private async save(settings = this.settings) {
    await writeFile(this.file + '.tmp', JSON.stringify(settings), { mode: 0o600 });
    await rename(this.file + '.tmp', this.file);
    this.settings = settings;
  }

  private configureChannel() {
    this.updater.channel = this.settings.channel === 'stable' ? 'latest' : 'nightly';
    this.updater.allowPrerelease = this.settings.channel === 'nightly';
    // Setting channel enables downgrades in electron-updater; only track switches may need one.
    this.updater.allowDowngrade = this.settings.channel !== channelOf(this.state.version);
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.emit(this.snapshot);
  }

  private fail(error: unknown) {
    this.set({
      status: this.disabledReason ? 'disabled' : 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
