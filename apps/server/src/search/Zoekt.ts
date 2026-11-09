import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { z } from 'zod';

export const searchResult = z.object({
  hits: z
    .array(
      z.object({
        path: z.string().max(8192),
        line: z.number().int().min(1),
        column: z.number().int().min(1),
        text: z.string().max(1000),
      }),
    )
    .max(500),
  truncated: z.boolean(),
});

const response = z.object({
  id: z.number().int(),
  value: z.unknown(),
  error: z.string().optional(),
});

export class Zoekt {
  private child;
  private serial = 0;
  private closed = false;
  private stderr = '';
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      dispose: () => void;
    }
  >();
  constructor(root: string, directory: string) {
    const binary =
      process.env.SF_ZOEKT_PATH ||
      fileURLToPath(
        new URL(
          `../../../../dist/zoekt${process.platform === 'win32' ? '.exe' : ''}`,
          import.meta.url,
        ),
      );
    this.child = spawn(binary, [root, directory], { cwd: root, stdio: 'pipe', windowsHide: true });
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4096);
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        const message = response.parse(JSON.parse(line));
        const pending = this.pending.get(message.id);
        if (!pending) return;
        pending.dispose();
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.value);
      } catch {
        this.fail(new Error('Code search returned an invalid response. Reopen search to retry.'));
      }
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('exit', () => {
      lines.close();
      this.fail(new Error(`Code search stopped. ${this.stderr.trim()}`));
    });
  }
  get available() {
    return !this.closed;
  }
  request(
    method: 'files' | 'index' | 'search' | 'scan',
    params: { paths?: string[]; query?: string; exclude?: string[] } = {},
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (this.closed)
      return Promise.reject(new Error('Code search stopped. Reopen search to retry.'));
    if (this.pending.size >= 8) return Promise.reject(new Error('Code search queue is full.'));
    const id = ++this.serial;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.fail(new Error('Code search timed out. Reopen search to retry.'));
        },
        method === 'index' || method === 'scan' ? 120000 : 15000,
      );
      const dispose = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      const abort = () => {
        dispose();
        this.child.stdin.write(JSON.stringify({ method: 'cancel', target: id }) + '\n');
        reject(signal!.reason);
      };
      this.pending.set(id, { resolve, reject, dispose });
      signal?.addEventListener('abort', abort, { once: true });
      this.child.stdin.write(JSON.stringify({ id, method, ...params }) + '\n');
    });
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.pending.values()) {
      task.dispose();
      task.reject(error);
    }
    this.pending.clear();
    this.child.kill();
  }
  async close() {
    const exited =
      !this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null
        ? Promise.resolve()
        : once(this.child, 'exit').catch(() => {});
    this.fail(new Error('Code search session released.'));
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
