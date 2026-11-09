import { utilityProcess } from 'electron';
import { dirname, join } from 'node:path';
import type { AppEvent, Input, Method, Results } from '@superfluid/contracts';

type BackendMessage = {
  ready?: boolean;
  event?: AppEvent;
  id?: number;
  result?: unknown;
  error?: string;
};

export class WorkspaceClient {
  private child: ReturnType<typeof utilityProcess.fork>;
  private serial = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly ready: Promise<void>;
  constructor(
    entrypoint: string,
    directory: string,
    emit: (event: AppEvent) => void,
    onExit: (code: number) => void,
  ) {
    this.child = utilityProcess.fork(entrypoint, [directory], {
      env: {
        ...process.env,
        PATH: `${process.env.PATH || '/usr/bin:/bin'}:/opt/homebrew/bin:/usr/local/bin`,
        SF_NODE_EXEC_PATH: process.execPath,
        SF_ZOEKT_PATH: join(
          dirname(entrypoint),
          `zoekt${process.platform === 'win32' ? '.exe' : ''}`,
        ).replace('app.asar/', 'app.asar.unpacked/'),
        SF_TY_PATH: join(
          dirname(entrypoint),
          `ty${process.platform === 'win32' ? '.exe' : ''}`,
        ).replace('app.asar/', 'app.asar.unpacked/'),
      },
      serviceName: 'Superfluid workspace',
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Workspace backend did not start.')), 15000);
      this.child.on('message', (message: BackendMessage) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    this.child.on('message', (message: BackendMessage) => {
      if (message.event) {
        emit(message.event);
        return;
      }
      if (message.id === undefined) return;
      const task = this.pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });
    this.child.on('exit', (code) => {
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error('Workspace backend stopped. Unsaved models remain in the editor.'));
      }
      this.pending.clear();
      onExit(code);
    });
  }
  call<M extends Method>(method: M, input: Input<M>): Promise<Results[M]>;
  call(method: 'shutdown', input: Record<string, never>): Promise<null>;
  call(method: Method | 'shutdown', input: unknown): Promise<unknown> {
    if (this.pending.size >= 128) return Promise.reject(new Error('Workspace queue is full.'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error('Workspace operation timed out. Its result may need checking before retry.'),
        );
      }, 150000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.postMessage({ id, method, input });
    });
  }
  kill() {
    this.child.kill();
  }
}
