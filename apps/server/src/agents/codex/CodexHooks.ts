import { mkdir, readFile, writeFile, rename, realpath, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { CodexIntegration } from '@superfluid/contracts';
import { codexHookSource } from './codexHook';

export const codexHookEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'Interrupt',
  'SessionEnd',
] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const marker = 'Superfluid agent status';

export class CodexHooks {
  readonly directory: string;
  readonly configPath: string;
  readonly helperPath: string;
  readonly connectionFile: string;
  private command: string;
  private queue = Promise.resolve();

  constructor(directory: string, options: { home?: string; executable?: string } = {}) {
    this.directory = join(directory, 'codex');
    this.configPath = join(
      options.home ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'),
      'hooks.json',
    );
    this.helperPath = join(this.directory, 'hook.cjs');
    this.connectionFile = join(this.directory, 'connection.json');
    this.command = `ELECTRON_RUN_AS_NODE=1 ${quote(options.executable ?? process.env.SF_NODE_EXEC_PATH ?? process.execPath)} ${quote(this.helperPath)}`;
  }

  private async read() {
    const file = await realpath(this.configPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return this.configPath;
    });
    const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    const config: unknown = text ? JSON.parse(text) : {};
    if (!record(config) || (config.hooks !== undefined && !record(config.hooks)))
      throw new Error('Codex hooks.json is not a valid hooks configuration.');
    return { file, text, config, hooks: (config.hooks ?? {}) as Record<string, unknown> };
  }

  private own(value: unknown) {
    return (
      record(value) &&
      value.statusMessage === marker &&
      typeof value.command === 'string' &&
      value.command.endsWith(` ${quote(this.helperPath)}`)
    );
  }

  async status(): Promise<CodexIntegration> {
    const { hooks } = await this.read();
    const enabled = codexHookEvents.every(
      (event) =>
        Array.isArray(hooks[event]) &&
        hooks[event].some(
          (group: unknown) =>
            record(group) &&
            Array.isArray(group.hooks) &&
            group.hooks.some((value) => this.own(value)),
        ),
    );
    return { enabled, configPath: this.configPath };
  }

  configure(enabled: boolean) {
    const task = this.queue.then(() => this.write(enabled));
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  async updateHelper() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.helperPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, codexHookSource(this.connectionFile), { mode: 0o600 });
      await rename(temporary, this.helperPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async write(enabled: boolean) {
    if (process.platform === 'win32')
      throw new Error('Codex status hooks currently require macOS or Linux.');
    const { file, text, config, hooks } = await this.read();
    const next = { ...hooks };
    for (const event of codexHookEvents) {
      const groups = hooks[event] ?? [];
      if (!Array.isArray(groups)) throw new Error(`Codex ${event} hooks must be an array.`);
      const kept = groups.flatMap((group) => {
        if (!record(group) || !Array.isArray(group.hooks)) return [group];
        const handlers = group.hooks.filter((value) => !this.own(value));
        return handlers.length === group.hooks.length
          ? [group]
          : handlers.length
            ? [{ ...group, hooks: handlers }]
            : [];
      });
      if (enabled)
        kept.push({
          hooks: [
            {
              type: 'command',
              command: this.command,
              timeout:
                event === 'PermissionRequest'
                  ? 300
                  : event === 'Interrupt' || event === 'SessionEnd'
                    ? 3
                    : 5,
              statusMessage: marker,
            },
          ],
        });
      if (kept.length) next[event] = kept;
      else delete next[event];
    }
    if (Object.keys(next).length) config.hooks = next;
    else delete config.hooks;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (enabled) await this.updateHelper();
    if (!enabled && !text) return { enabled: false, configPath: this.configPath };
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    const mode = await stat(file)
      .then((value) => value.mode & 0o777)
      .catch(() => 0o600);
    try {
      await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode });
      if (
        (await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        })) !== text
      )
        throw new Error('Codex hooks changed during setup. Try again.');
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return { enabled, configPath: this.configPath };
  }
}
