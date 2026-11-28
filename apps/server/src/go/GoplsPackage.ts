import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppEvent, GoInstallProgress, GoPackageStatus } from '@superfluid/contracts';
import { unpackGoToolchain } from '../../../../scripts/go-toolchain.ts';
import { command } from '../process/ProcessRunner';
import {
  findGoTool,
  goEnvironment,
  goName,
  goplsName,
  managedGo,
  managedGopls,
} from './goExecutables';

const module = 'golang.org/x/tools/gopls@v0.24.0';

export class GoplsPackage {
  private readonly binary: string;
  private readonly download = new AbortController();
  private task?: {
    operation: NonNullable<GoPackageStatus['operation']>;
    finished: Promise<void>;
  };
  private error?: string;
  private progress?: GoInstallProgress;

  constructor(
    private directory: string,
    private notify: (event: AppEvent) => void,
    private resetServers: () => void,
  ) {
    this.binary = managedGopls(directory);
  }

  async status(): Promise<GoPackageStatus> {
    const env = goEnvironment(this.directory);
    const [managed, external, go] = await Promise.all([
      findGoTool(this.binary, env),
      findGoTool(env.SF_GOPLS_PATH || goplsName, env),
      findGoTool(goName, env),
    ]);
    return {
      source: managed ? 'managed' : external ? 'external' : 'missing',
      goAvailable: Boolean(go),
      operation: this.task?.operation ?? null,
      ...(this.progress ? { progress: this.progress } : {}),
      error: this.error,
    };
  }

  install() {
    return this.start('installing', async () => {
      const env = goEnvironment(this.directory);
      const [installed, go] = await Promise.all([
        findGoTool(this.binary, env),
        findGoTool(goName, env),
      ]);
      if (installed && go) return false;
      const directory = dirname(this.binary);
      await mkdir(directory, { recursive: true });
      const staging = await mkdtemp(join(directory, '.gopls-'));
      const stagedGo = join(staging, 'go');
      const toolchain = managedGo(this.directory);
      const { signal } = this.download;
      try {
        if (!go) {
          this.reportProgress({ stage: 'downloading-go' });
          await unpackGoToolchain(staging, {
            signal,
            onDownload: (percent) => this.reportProgress({ stage: 'downloading-go', percent }),
            onUnpack: () => this.reportProgress({ stage: 'unpacking-go' }),
          });
        }
        let binary: string | undefined;
        if (!installed) {
          this.reportProgress({ stage: 'installing-gopls' });
          await command(go ?? join(stagedGo, 'bin', goName), ['install', module], {
            cwd: staging,
            env: {
              ...env,
              GOROOT: go && go !== join(toolchain, 'bin', goName) ? env.GOROOT : '',
              GOBIN: staging,
              CGO_ENABLED: '0',
              GO111MODULE: 'on',
              GOWORK: 'off',
              GOOS: process.platform === 'win32' ? 'windows' : process.platform,
              GOARCH:
                process.arch === 'x64' ? 'amd64' : process.arch === 'ia32' ? '386' : process.arch,
            },
            timeout: 10 * 60 * 1000,
          });
          binary = await findGoTool(join(staging, goplsName), env);
          if (!binary) throw new Error('Go finished without producing a gopls executable.');
        }
        signal.throwIfAborted();
        if (!go) await rename(stagedGo, toolchain);
        try {
          if (binary) await rename(binary, this.binary);
        } catch (error) {
          if (!go) await rm(toolchain, { recursive: true, force: true });
          throw error;
        }
        return true;
      } finally {
        await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    });
  }

  remove() {
    return this.start('removing', async () => {
      if (!(await findGoTool(this.binary, goEnvironment(this.directory)))) return false;
      await rm(managedGo(this.directory), { recursive: true, force: true });
      await rm(this.binary, { force: true });
      return true;
    });
  }

  private start(operation: NonNullable<GoPackageStatus['operation']>, run: () => Promise<boolean>) {
    if (this.task) {
      if (this.task.operation === operation) return null;
      throw new Error('Wait for the Go language package operation to finish.');
    }
    this.error = undefined;
    let changed = false;
    const finished = run()
      .then((result) => {
        changed = result;
        if (changed) this.resetServers();
      })
      .catch((error: unknown) => {
        this.error = (error instanceof Error ? error.message : String(error)).slice(-2000);
      })
      .finally(() => {
        this.task = undefined;
        this.progress = undefined;
        this.notify({ type: 'go.package', changed });
      });
    this.task = { operation, finished };
    this.notify({ type: 'go.package', changed: false });
    return null;
  }

  private reportProgress(progress: GoInstallProgress) {
    this.progress = progress;
    this.notify({ type: 'go.package.progress', progress });
  }

  async close() {
    await this.task?.finished;
  }

  cancelDownload() {
    this.download.abort();
  }
}
