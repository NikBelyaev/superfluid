import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Session, AppEvent } from '@superfluid/contracts';
import type { Store } from '../persistence/Store';

const require = createRequire(import.meta.url);

export class LanguageServers {
  private servers = new Map<string, Server>();
  constructor(
    private store: Store,
    private notify: (event: AppEvent) => void,
  ) {}
  async get(s: Session) {
    let server = this.servers.get(s.id);
    if (server?.available) {
      this.servers.delete(s.id);
      this.servers.set(s.id, server);
      return server;
    }
    if (server) this.servers.delete(s.id);
    if (this.servers.size >= 2) {
      const [id, old] = this.servers.entries().next().value!;
      old.close();
      this.servers.delete(id);
    }
    server = new Server(s, this.notify, () => this.store.drafts(s.id));
    this.servers.set(s.id, server);
    return server;
  }
  invalidate(id: string) {
    this.servers.get(id)?.close();
    this.servers.delete(id);
  }
  changed(id: string, path: string, event: 'rename' | 'change') {
    void this.servers
      .get(id)
      ?.changed(path, event)
      .catch(() => {});
  }
  close() {
    for (const s of this.servers.values()) s.close();
    this.servers.clear();
  }
}

class Server {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private serial = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private documents = new Map<string, number>();
  private ready: Promise<void>;
  private generation = Date.now();
  private closed = false;
  private stderr = '';
  get available() {
    return !this.closed;
  }
  private settings() {
    return {
      pythonPath: this.session.python,
      analysis: {
        diagnosticMode: 'openFilesOnly',
        autoSearchPaths: true,
        typeCheckingMode: 'basic',
        // shortcut: Enable auto-imports when Monaco supports completion resolve and extra edits.
        autoImportCompletions: false,
      },
    };
  }
  constructor(
    private session: Session,
    private notify: (event: AppEvent) => void,
    drafts: () => ReturnType<Store['drafts']>,
  ) {
    this.child = spawn(
      process.env.SF_NODE_EXEC_PATH || process.execPath,
      [
        require.resolve('pyright/langserver.index.js').replace('app.asar/', 'app.asar.unpacked/'),
        '--stdio',
      ],
      { cwd: session.path, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' },
    );
    this.child.stdout.on('data', (chunk) => {
      try {
        this.receive(chunk);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4096);
    });
    this.child.on('error', (e) => this.fail(e));
    this.child.on('exit', (code) =>
      this.fail(
        new Error(
          `Python language server stopped (${code}). ${this.stderr.trim() || 'The next request will restart it.'}`,
        ),
      ),
    );
    this.notify({
      type: 'lsp.status',
      sessionId: session.id,
      status: 'Warming Python intelligence…',
    });
    this.ready = this.requestRaw('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(session.path).href,
      workspaceFolders: [
        {
          uri: pathToFileURL(session.path).href,
          name: session.branch || session.path.split('/').at(-1) || 'Project',
        },
      ],
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true } },
          publishDiagnostics: { versionSupport: true },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          workspaceEdit: { documentChanges: true },
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
      initializationOptions: {},
    }).then(() => {
      this.send('initialized', {});
      this.send('workspace/didChangeConfiguration', { settings: { python: this.settings() } });
      for (const d of drafts()) this.openRaw(d.path, d.text, d.version);
      this.notify({ type: 'lsp.status', sessionId: session.id, status: 'Python ready' });
    });
    this.ready.catch((error) => this.fail(error));
  }
  private write(message: unknown) {
    if (this.closed || !this.child.stdin.writable)
      throw new Error('Python language server is unavailable.');
    const json = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
  private send(method: string, params: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }
  private requestRaw(method: string, params: unknown): Promise<any> {
    if (this.pending.size >= 32) return Promise.reject(new Error('Python request queue is full.'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try {
          this.send('$/cancelRequest', { id });
        } catch {}
        reject(new Error('Python request timed out.'));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private receive(chunk: Buffer) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.close();
      return;
    }
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const m = this.buffer
        .subarray(0, end)
        .toString()
        .match(/Content-Length: (\d+)/i);
      if (!m) {
        this.close();
        return;
      }
      const length = +m[1];
      if (this.buffer.length < end + 4 + length) return;
      let message: any;
      try {
        message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString());
        if (!message || typeof message !== 'object') throw new Error('Invalid message');
      } catch {
        this.fail(
          new Error('Python returned an invalid response. The next request will restart it.'),
        );
        return;
      }
      this.buffer = this.buffer.subarray(end + 4 + length);
      if (message.method === 'textDocument/publishDiagnostics') {
        if (typeof message.params?.uri === 'string' && Array.isArray(message.params.diagnostics))
          this.notify({
            type: 'diagnostics',
            sessionId: this.session.id,
            generation: this.generation,
            uri: message.params.uri,
            diagnostics: message.params.diagnostics,
          });
      } else if (message.method && message.id !== undefined) {
        const settings = this.settings();
        const result =
          message.method === 'workspace/configuration' && Array.isArray(message.params?.items)
            ? message.params.items.map((item: any) =>
                item.section === 'python.analysis'
                  ? settings.analysis
                  : item.section === 'python'
                    ? settings
                    : { python: settings },
              )
            : message.method === 'workspace/workspaceFolders'
              ? [
                  {
                    uri: pathToFileURL(this.session.path).href,
                    name: this.session.branch || 'Project',
                  },
                ]
              : null;
        this.write({ jsonrpc: '2.0', id: message.id, result });
      } else if (message.id !== undefined) {
        const task = this.pending.get(message.id);
        if (!task) continue;
        clearTimeout(task.timer);
        this.pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error.message));
        else task.resolve(message.result);
      }
    }
  }
  private openRaw(path: string, text: string, version: number) {
    const uri = pathToFileURL(join(this.session.path, path)).href,
      previous = this.documents.get(uri);
    if (previous === undefined)
      this.send('textDocument/didOpen', {
        textDocument: { uri, languageId: 'python', version, text },
      });
    else if (version > previous)
      this.send('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    this.documents.set(uri, Math.max(version, previous ?? -1));
  }
  async open(path: string, text: string, version: number) {
    await this.ready;
    this.openRaw(path, text, version);
  }
  async documentClose(path: string) {
    await this.ready;
    const uri = pathToFileURL(join(this.session.path, path)).href;
    this.send('textDocument/didClose', { textDocument: { uri } });
    this.documents.delete(uri);
  }
  async request(method: string, params: unknown) {
    await this.ready;
    return this.requestRaw(method, params);
  }
  async changed(path: string, event: 'rename' | 'change') {
    await this.ready;
    const file = join(this.session.path, path);
    const type =
      event === 'change'
        ? 2
        : await stat(file).then(
            () => 1,
            () => 3,
          );
    this.send('workspace/didChangeWatchedFiles', {
      changes: [{ uri: pathToFileURL(file).href, type }],
    });
  }
  private fail(error: Error) {
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.pending.clear();
    if (!this.closed) {
      this.notify({ type: 'lsp.status', sessionId: this.session.id, status: error.message });
      this.closed = true;
      this.child.kill();
    }
  }
  close() {
    this.closed = true;
    this.fail(new Error('Python server session released.'));
    this.child.kill();
  }
}
