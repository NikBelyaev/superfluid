import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import type { Session, AppEvent } from '@superfluid/contracts';
import type { Store } from '../persistence/Store';
import { inspectInterpreter, languageServerFor } from './interpreter';
import { searchExcludes } from '../files/searchPaths';

const require = createRequire(import.meta.url);

export class LanguageServers {
  private servers = new Map<string, Server>();
  private generation = 0;
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
    if (server) this.invalidate(s.id);
    s = this.store.get<Session>('sessions', s.id) ?? s;
    if (this.servers.size >= 2) {
      const [id, old] = this.servers.entries().next().value!;
      old.close();
      this.servers.delete(id);
    }
    server = new Server({ ...s }, ++this.generation, this.notify, () => this.store.drafts(s.id));
    this.servers.set(s.id, server);
    return server;
  }
  invalidate(id: string) {
    const running = this.servers.has(id);
    this.servers.get(id)?.close();
    this.servers.delete(id);
    this.notify({
      type: 'lsp.status',
      sessionId: id,
      generation: ++this.generation,
      phase: 'stopped',
      status: 'Python intelligence paused',
    });
    return running;
  }
  async documentClose(id: string, path: string) {
    await this.servers.get(id)?.documentClose(path);
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
  private symbolServer?: Server;
  private child?: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private serial = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; dispose: () => void }
  >();
  private documents = new Map<string, number>();
  private ready: Promise<void>;
  private closed = false;
  private released = false;
  private stderr = '';
  kind: 'ty' | 'pyright' = 'pyright';
  private executable = '';
  private fallback = '';
  get available() {
    return !this.closed;
  }
  private settings() {
    return {
      pythonPath: this.executable,
      analysis: {
        diagnosticMode: 'openFilesOnly',
        autoSearchPaths: true,
        typeCheckingMode: 'basic',
        // shortcut: Enable auto-imports when Monaco supports completion resolve and extra edits.
        autoImportCompletions: false,
      },
    };
  }
  private configuration() {
    return this.kind === 'ty'
      ? {
          ty: {
            configuration: {
              environment: { python: this.executable },
              src: { exclude: searchExcludes },
            },
            diagnosticMode: 'openFilesOnly',
            completions: { autoImport: false },
          },
        }
      : { python: this.settings() };
  }
  private status(phase: 'starting' | 'ready' | 'stopped' | 'error', status: string) {
    this.notify({
      type: 'lsp.status',
      sessionId: this.session.id,
      generation: this.generation,
      server: this.kind,
      phase,
      status,
    });
  }
  constructor(
    private session: Session,
    readonly generation: number,
    private notify: (event: AppEvent) => void,
    private drafts: () => ReturnType<Store['drafts']>,
    private role: 'editor' | 'symbols' = 'editor',
  ) {
    this.status('starting', 'Checking Python interpreter…');
    this.ready = this.start(drafts);
    this.ready.catch((error) => this.fail(error));
  }
  private async start(drafts: () => ReturnType<Store['drafts']>) {
    const interpreter = await inspectInterpreter(this.session.python, this.session.path);
    if (this.released) throw new Error('Python server session released.');
    this.executable = interpreter.executable;
    this.kind = this.role === 'symbols' ? 'ty' : languageServerFor(interpreter.version);
    try {
      await this.launch(drafts);
    } catch (error) {
      if (this.kind !== 'ty' || this.released || this.role === 'symbols') throw error;
      this.child?.kill();
      this.child = undefined;
      this.closed = false;
      this.buffer = Buffer.alloc(0);
      this.stderr = '';
      this.documents.clear();
      this.kind = 'pyright';
      this.fallback = ` (ty unavailable: ${error instanceof Error ? error.message : String(error)})`;
      await this.launch(drafts);
    }
  }
  private async launch(drafts: () => ReturnType<Store['drafts']>) {
    if (this.released) throw new Error('Python server session released.');
    const ty =
      process.env.SF_TY_PATH ||
      fileURLToPath(
        new URL(
          `../../../../dist/ty${process.platform === 'win32' ? '.exe' : ''}`,
          import.meta.url,
        ),
      );
    const child = (this.child = spawn(
      this.kind === 'ty' ? ty : process.env.SF_NODE_EXEC_PATH || process.execPath,
      this.kind === 'ty'
        ? ['server']
        : [
            require
              .resolve('pyright/langserver.index.js')
              .replace('app.asar/', 'app.asar.unpacked/'),
            '--stdio',
          ],
      { cwd: this.session.path, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' },
    ));
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      try {
        this.receive(chunk);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.on('error', (error) => {
      if (this.child === child) this.fail(error);
    });
    child.stderr.on('data', (chunk) => {
      if (this.child !== child) return;
      this.stderr = (this.stderr + chunk.toString()).slice(-4096);
    });
    child.on('error', (e) => {
      if (this.child === child) this.fail(e);
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.fail(
        new Error(
          `Python language server stopped (${code}). ${this.stderr.trim() || 'The next request will restart it.'}`,
        ),
      );
    });
    this.status('starting', `Warming ${this.kind === 'ty' ? 'ty' : 'Pyright'}…${this.fallback}`);
    await this.requestRaw('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(this.session.path).href,
      workspaceFolders: [
        {
          uri: pathToFileURL(this.session.path).href,
          name: this.session.branch || this.session.path.split('/').at(-1) || 'Project',
        },
      ],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['markdown'] },
          completion: { completionItem: { snippetSupport: true } },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: { versionSupport: true },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          workspaceEdit: { documentChanges: true },
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
      initializationOptions: this.kind === 'ty' ? this.configuration().ty : {},
    });
    if (this.released) throw new Error('Python server session released.');
    this.send('initialized', {});
    this.send('workspace/didChangeConfiguration', { settings: this.configuration() });
    for (const d of drafts())
      if (this.role === 'editor' || /\.pyi?$/.test(d.path)) this.openRaw(d.path, d.text, d.version);
    this.status('ready', `${this.kind === 'ty' ? 'ty' : 'Pyright'} ready${this.fallback}`);
  }
  private write(message: unknown) {
    if (this.closed || !this.child?.stdin.writable)
      throw new Error('Python language server is unavailable.');
    const json = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
  private send(method: string, params: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }
  private requestRaw(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    if (this.pending.size >= 32) return Promise.reject(new Error('Python request queue is full.'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const dispose = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.pending.delete(id);
      };
      const cancel = (error: Error) => {
        dispose();
        try {
          this.send('$/cancelRequest', { id });
        } catch {}
        reject(error);
      };
      const aborted = () => cancel(signal!.reason);
      const timer = setTimeout(() => cancel(new Error('Python request timed out.')), 15000);
      this.pending.set(id, { resolve, reject, dispose });
      signal?.addEventListener('abort', aborted, { once: true });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (e: any) {
        dispose();
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
            server: this.kind,
            uri: message.params.uri,
            diagnostics: message.params.diagnostics,
          });
      } else if (message.method && message.id !== undefined) {
        const settings = this.settings();
        const configuration = this.configuration();
        const result =
          message.method === 'workspace/configuration' && Array.isArray(message.params?.items)
            ? message.params.items.map((item: any) =>
                item.section === 'ty'
                  ? (configuration.ty ?? null)
                  : item.section === 'python.analysis'
                    ? settings.analysis
                    : item.section === 'python'
                      ? settings
                      : configuration,
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
        task.dispose();
        if (message.error) task.reject(new Error(message.error.message));
        else task.resolve(message.result);
      }
    }
  }
  private openRaw(path: string, text: string, version: number) {
    const uri = pathToFileURL(join(this.session.path, path)).href,
      previous = this.documents.get(uri);
    if (previous === undefined) {
      this.send('textDocument/didOpen', {
        textDocument: { uri, languageId: 'python', version, text },
      });
      // ty needs a workspace invalidation to update imports of a newly opened overlay.
      if (this.kind === 'ty')
        this.send('workspace/didChangeWatchedFiles', { changes: [{ uri, type: 2 }] });
    } else if (version > previous)
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
  async request(method: string, params: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.ready;
    if (method === 'workspace/symbol' && this.kind === 'pyright') {
      // Pyright only searches analyzed files; ty supplies the workspace symbol index without changing older-Python diagnostics.
      if (!this.symbolServer?.available)
        this.symbolServer = new Server(
          this.session,
          this.generation,
          () => {},
          this.drafts,
          'symbols',
        );
      await this.symbolServer.ready;
      const drafts = this.drafts().filter((draft) => /\.pyi?$/.test(draft.path));
      const uris = new Set(
        drafts.map((draft) => pathToFileURL(join(this.session.path, draft.path)).href),
      );
      for (const uri of this.symbolServer.documents.keys())
        if (!uris.has(uri))
          await this.symbolServer.documentClose(relative(this.session.path, fileURLToPath(uri)));
      for (const draft of drafts)
        await this.symbolServer.open(draft.path, draft.text, draft.version);
      const value = await this.symbolServer.requestRaw(method, params, signal);
      this.symbolServer.assertCurrent();
      this.assertCurrent();
      return value;
    }
    const result = await this.requestRaw(method, params, signal);
    this.assertCurrent();
    return result;
  }
  async symbolOutline(uri: string, signal?: AbortSignal) {
    const server = this.kind === 'pyright' ? this.symbolServer : this;
    if (!server?.available) throw new Error('Python symbol server changed. Try again.');
    const result = await server.request(
      'textDocument/documentSymbol',
      { textDocument: { uri } },
      signal,
    );
    this.assertCurrent();
    return result;
  }
  assertCurrent() {
    if (this.closed) throw new Error('Python environment changed. Try again.');
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
    await this.symbolServer?.changed(path, event);
  }
  private fail(error: Error) {
    for (const task of this.pending.values()) {
      task.dispose();
      task.reject(error);
    }
    this.pending.clear();
    if (!this.closed) {
      this.closed = true;
      this.status('error', error.message);
      this.child?.kill();
      this.symbolServer?.close();
    }
  }
  close() {
    this.symbolServer?.close();
    this.released = true;
    this.closed = true;
    this.fail(new Error('Python server session released.'));
    this.child?.kill();
    this.status('stopped', 'Python intelligence paused');
  }
}
