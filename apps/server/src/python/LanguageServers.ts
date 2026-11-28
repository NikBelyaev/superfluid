import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { goDiagnostic, type Session, type AppEvent } from '@superfluid/contracts';
import type { Store } from '../persistence/Store';
import { inspectInterpreter, languageServerFor } from './interpreter';
import { searchExcludes } from '../files/searchPaths';
import {
  findGoTool,
  goEnvironment,
  goName,
  goplsName,
  managedGo,
  managedGopls,
} from '../go/goExecutables';

const require = createRequire(import.meta.url);
const installGoplsMessage = 'Install gopls in Settings → Languages';

export class LanguageServers {
  private servers = new Map<string, Server>();
  private goServers = new Map<string, Server>();
  private generation = 0;
  constructor(
    private store: Store,
    private notify: (event: AppEvent) => void,
  ) {}
  async get(s: Session, language: 'python' | 'go' = 'python') {
    const servers = language === 'go' ? this.goServers : this.servers;
    let server = servers.get(s.id);
    if (server && (server.available || server.missingExecutable)) {
      servers.delete(s.id);
      servers.set(s.id, server);
      return server;
    }
    if (server && language === 'python') this.invalidate(s.id);
    s = this.store.get<Session>('sessions', s.id) ?? s;
    servers.delete(s.id);
    if (servers.size >= 2) {
      const [id, old] = servers.entries().next().value!;
      old.close();
      servers.delete(id);
    }
    server = new Server(
      { ...s },
      ++this.generation,
      this.notify,
      () => this.store.drafts(s.id),
      language === 'go' ? 'go' : 'editor',
      language === 'go' ? this.store.directory : undefined,
    );
    servers.set(s.id, server);
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
  async documentClose(id: string, path: string, language: 'python' | 'go' = 'python') {
    const servers = language === 'go' ? this.goServers : this.servers;
    const server = servers.get(id);
    if (server?.available) await server.documentClose(path);
  }
  goServer(id: string, generation: number) {
    const server = this.goServers.get(id);
    if (!server?.available || server.generation !== generation)
      throw new Error('Go language server changed. Try again.');
    this.goServers.delete(id);
    this.goServers.set(id, server);
    return server;
  }
  goSaved(id: string, path: string, text: string) {
    if (path.endsWith('.go'))
      void this.goServers
        .get(id)
        ?.saved(path, text)
        .catch(() => {});
  }
  changed(id: string, path: string, event: 'rename' | 'change') {
    void this.servers
      .get(id)
      ?.changed(path, event)
      .catch(() => {});
    if (/\.go$|(?:^|\/)go\.(?:mod|sum|work|work\.sum)$/.test(path))
      void this.goServers
        .get(id)
        ?.changed(path, event)
        .catch(() => {});
  }
  resetGo() {
    for (const s of this.goServers.values()) s.close();
    this.goServers.clear();
  }
  close() {
    for (const s of this.servers.values()) s.close();
    this.servers.clear();
    this.resetGo();
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
  private documents = new Map<string, { version: number; text: string }>();
  private ready: Promise<void>;
  private closed = false;
  private released = false;
  private stderr = '';
  missingExecutable = false;
  kind: 'ty' | 'pyright' | 'gopls' = 'pyright';
  private executable = '';
  private fallback = '';
  private get name() {
    return this.kind === 'gopls' ? 'gopls' : this.kind === 'ty' ? 'ty' : 'Pyright';
  }
  private get language() {
    return this.role === 'go' ? 'Go' : 'Python';
  }
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
        autoImportCompletions: true,
        indexing: true,
      },
    };
  }
  private configuration() {
    if (this.kind === 'gopls') return {};
    return this.kind === 'ty'
      ? {
          ty: {
            configuration: {
              environment: { python: this.executable },
              src: { exclude: searchExcludes },
            },
            diagnosticMode: 'openFilesOnly',
            completions: { autoImport: true },
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
      ...(this.missingExecutable && phase === 'error' ? { needsInstallation: true } : {}),
    });
  }
  constructor(
    private session: Session,
    readonly generation: number,
    private notify: (event: AppEvent) => void,
    private drafts: () => ReturnType<Store['drafts']>,
    private role: 'editor' | 'symbols' | 'go' = 'editor',
    private appDirectory?: string,
  ) {
    if (role === 'go') {
      this.kind = 'gopls';
      this.ready = this.launch(drafts);
    } else {
      this.status('starting', 'Checking Python interpreter…');
      this.ready = this.start(drafts);
    }
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
    if (this.released) throw new Error(`${this.language} server session released.`);
    const ty =
      process.env.SF_TY_PATH ||
      fileURLToPath(
        new URL(
          `../../../../dist/ty${process.platform === 'win32' ? '.exe' : ''}`,
          import.meta.url,
        ),
      );
    const env =
      this.kind === 'gopls'
        ? goEnvironment(this.appDirectory)
        : { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    let executable: string, args: string[];
    if (this.kind === 'gopls') {
      const managed = this.appDirectory && (await findGoTool(managedGopls(this.appDirectory), env));
      const gopls = managed || (await findGoTool(env.SF_GOPLS_PATH || goplsName, env));
      if (
        env.GOROOT &&
        this.appDirectory &&
        (await findGoTool(goName, env)) === join(managedGo(this.appDirectory), 'bin', goName)
      )
        delete env.GOROOT;
      if (this.released) throw new Error('Go server session released.');
      if (!gopls) {
        this.missingExecutable = true;
        throw new Error(installGoplsMessage);
      }
      executable = gopls;
      args = [];
    } else if (this.kind === 'ty') {
      executable = ty;
      args = ['server'];
    } else {
      executable = process.env.SF_NODE_EXEC_PATH || process.execPath;
      args = [
        require.resolve('pyright/langserver.index.js').replace('app.asar/', 'app.asar.unpacked/'),
        '--stdio',
      ];
    }
    const child = (this.child = spawn(executable, args, {
      cwd: this.session.path,
      env,
      stdio: 'pipe',
    }));
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
      if (this.child !== child) return;
      this.missingExecutable = this.kind === 'gopls' && 'code' in e && e.code === 'ENOENT';
      this.fail(this.missingExecutable ? new Error(installGoplsMessage) : e);
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.fail(
        new Error(
          `${this.language} language server stopped (${code}). ${this.stderr.trim() || 'The next request will restart it.'}`,
        ),
      );
    });
    this.status('starting', `Warming ${this.name}…${this.fallback}`);
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
        ...(this.kind === 'gopls' ? { general: { positionEncodings: ['utf-16'] } } : {}),
        textDocument: {
          hover: { contentFormat: ['markdown'] },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              labelDetailsSupport: true,
              ...(this.kind === 'gopls'
                ? {}
                : {
                    resolveSupport: {
                      properties: ['documentation', 'detail', 'additionalTextEdits'],
                    },
                  }),
            },
          },
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
    if (this.released) throw new Error(`${this.language} server session released.`);
    this.send('initialized', {});
    this.send('workspace/didChangeConfiguration', { settings: this.configuration() });
    for (const d of drafts()) {
      if (d.path.endsWith('.go') !== (this.role === 'go')) continue;
      if (this.role !== 'symbols' || /\.pyi?$/.test(d.path))
        this.openRaw(d.path, d.text, d.version);
    }
    this.status('ready', `${this.name} ready${this.fallback}`);
  }
  private write(message: unknown) {
    if (this.closed || !this.child?.stdin.writable)
      throw new Error(`${this.language} language server is unavailable.`);
    const json = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
  private send(method: string, params: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }
  private requestRaw(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    if (this.pending.size >= 32)
      return Promise.reject(new Error(`${this.language} request queue is full.`));
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
      const timer = setTimeout(
        () => cancel(new Error(`${this.language} request timed out.`)),
        15000,
      );
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
          new Error(
            `${this.language} returned an invalid response. The next request will restart it.`,
          ),
        );
        return;
      }
      this.buffer = this.buffer.subarray(end + 4 + length);
      if (message.method === 'textDocument/publishDiagnostics') {
        if (
          typeof message.params?.uri === 'string' &&
          Array.isArray(message.params.diagnostics) &&
          (this.kind !== 'gopls' || this.documents.has(message.params.uri))
        )
          this.notify({
            type: 'diagnostics',
            sessionId: this.session.id,
            generation: this.generation,
            server: this.kind,
            uri: message.params.uri,
            ...(this.kind === 'gopls' && Number.isInteger(message.params.version)
              ? { version: message.params.version }
              : {}),
            diagnostics:
              this.kind === 'gopls'
                ? (message.params.diagnostics as unknown[]).slice(0, 500).flatMap((entry) => {
                    const parsed = goDiagnostic.safeParse(entry);
                    return parsed.success ? [parsed.data] : [];
                  })
                : message.params.diagnostics,
          });
      } else if (message.method && message.id !== undefined) {
        const settings = this.settings();
        const configuration = this.configuration();
        const result =
          message.method === 'workspace/configuration' && Array.isArray(message.params?.items)
            ? message.params.items.map((item: any) =>
                this.kind === 'gopls'
                  ? null
                  : item.section === 'ty'
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
        if (message.error)
          task.reject(
            Object.assign(new Error(message.error.message), { code: message.error.code }),
          );
        else task.resolve(message.result);
      }
    }
  }
  private openRaw(path: string, text: string, version: number) {
    const uri = pathToFileURL(join(this.session.path, path)).href,
      previous = this.documents.get(uri)?.version;
    if (previous === undefined) {
      this.send('textDocument/didOpen', {
        textDocument: { uri, languageId: this.role === 'go' ? 'go' : 'python', version, text },
      });
      // ty needs a workspace invalidation to update imports of a newly opened overlay.
      if (this.kind === 'ty')
        this.send('workspace/didChangeWatchedFiles', { changes: [{ uri, type: 2 }] });
    } else if (version > previous)
      this.send('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    if (previous === undefined || version > previous) this.documents.set(uri, { version, text });
  }
  async open(path: string, text: string, version: number) {
    await this.ready;
    this.openRaw(path, text, version);
    if (this.symbolServer?.available) await this.symbolServer.open(path, text, version);
  }
  async documentClose(path: string) {
    await this.ready;
    const uri = pathToFileURL(join(this.session.path, path)).href;
    if (this.kind === 'gopls' && !this.documents.has(uri)) return;
    this.send('textDocument/didClose', { textDocument: { uri } });
    this.documents.delete(uri);
  }
  async saved(path: string, text: string) {
    await this.ready;
    const uri = pathToFileURL(join(this.session.path, path)).href;
    if (this.documents.get(uri)?.text === text)
      this.send('textDocument/didSave', { textDocument: { uri } });
  }
  private async symbolIndex() {
    if (!this.symbolServer?.available)
      this.symbolServer = new Server(
        this.session,
        this.generation,
        () => {},
        this.drafts,
        'symbols',
      );
    const server = this.symbolServer;
    await server.ready;
    const drafts = this.drafts().filter((draft) => /\.pyi?$/.test(draft.path));
    const uris = new Set(
      drafts.map((draft) => pathToFileURL(join(this.session.path, draft.path)).href),
    );
    for (const uri of server.documents.keys())
      if (!uris.has(uri) && !this.documents.has(uri))
        await server.documentClose(relative(this.session.path, fileURLToPath(uri)));
    for (const draft of drafts) await server.open(draft.path, draft.text, draft.version);
    for (const [uri, document] of this.documents)
      await server.open(
        relative(this.session.path, fileURLToPath(uri)),
        document.text,
        document.version,
      );
    return server;
  }
  async importServer(path: string, text: string, version: number) {
    await this.open(path, text, version);
    const server = this.kind === 'pyright' ? await this.symbolIndex() : this;
    await server.open(path, text, version);
    return server;
  }
  async request(method: string, params: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.ready;
    if (method === 'workspace/symbol' && this.kind === 'pyright') {
      // Pyright only searches analyzed files; ty supplies the workspace symbol index without changing older-Python diagnostics.
      const server = await this.symbolIndex();
      const value = await server.requestRaw(method, params, signal);
      server.assertCurrent();
      this.assertCurrent();
      return value;
    }
    const trigger = (params as { context?: { triggerCharacter?: string } })?.context
      ?.triggerCharacter;
    if (method === 'textDocument/completion' && this.kind === 'pyright' && trigger !== '.') {
      const [local, indexed] = await Promise.all([
        this.requestRaw(method, params, signal),
        this.symbolIndex()
          .then(async (symbols) => {
            const result = await symbols.requestRaw(method, params, signal);
            symbols.assertCurrent();
            return result;
          })
          .catch(() => {
            signal?.throwIfAborted();
            return undefined;
          }),
      ]);
      const items = local?.items ?? local ?? [];
      const names = new Set(items.map((item: { label: string }) => item.label));
      // Pyright only indexes analyzed modules; the existing ty index supplies unopened imports.
      const imports = (indexed?.items ?? indexed ?? []).filter(
        (item: { label: string; additionalTextEdits?: unknown[] }) =>
          item.additionalTextEdits?.length && !names.has(item.label),
      );
      this.assertCurrent();
      return { items: [...items, ...imports], isIncomplete: !!local?.isIncomplete };
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
    if (this.closed) throw new Error(`${this.language} environment changed. Try again.`);
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
    this.fail(new Error(`${this.language} server session released.`));
    this.child?.kill();
    this.status('stopped', `${this.language} intelligence paused`);
  }
}
