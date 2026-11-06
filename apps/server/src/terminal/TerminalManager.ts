import { Worker } from 'node:worker_threads';
import type { AppEvent, Run } from '@superfluid/contracts';

export class TerminalManager {
  private worker: Worker;
  private serial = 0;
  private closing = false;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  runs: Run[] = [];
  constructor(
    notify: (event: AppEvent) => void,
    workerPath = new URL('./terminal-worker.mjs', import.meta.url),
  ) {
    this.worker = new Worker(workerPath);
    this.worker.on('message', (message) => {
      if (message.event) {
        if (message.event.type === 'runs') this.runs = message.event.runs;
        notify(message.event);
        return;
      }
      const task = this.pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });
    const fail = (e: Error) => {
      for (const t of this.pending.values()) {
        clearTimeout(t.timer);
        t.reject(e);
      }
      this.pending.clear();
      notify({ type: 'error', message: e.message });
    };
    this.worker.on('error', fail);
    this.worker.on('exit', (code) => {
      if (code !== 0 && !this.closing)
        fail(new Error('Terminal engine stopped. Running sessions may need restarting.'));
    });
  }
  call(method: string, input: unknown): Promise<any> {
    if (this.pending.size >= 64)
      return Promise.reject(new Error('Terminal command queue is full.'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Terminal engine did not respond.'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, method, input });
    });
  }
  async close() {
    this.closing = true;
    try {
      await this.call('shutdown', {});
    } finally {
      await this.worker.terminate();
    }
  }
}
