import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, isAbsolute, relative, join } from 'node:path';
import { access } from 'node:fs/promises';
import type { Session, ParsedInput, PythonDefinition, PythonLocation } from '@superfluid/contracts';
import { LanguageServers } from './LanguageServers';
import { WorkspaceWatcher } from '../workspace/WorkspaceWatcher';
import { within } from '../files/paths';
import { command } from '../process/ProcessRunner';
import { FileService } from '../files/FileService';
import { DocumentService } from '../files/DocumentService';

type Range = { start: PythonLocation['position']; end: PythonLocation['position'] };
interface Symbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange?: Range;
  children?: Symbol[];
}
type Definition =
  { uri: string; range: Range } | { targetUri: string; targetSelectionRange: Range };

function scopesAt(symbols: Symbol[], position: PythonLocation['position']): Symbol[] {
  for (const symbol of symbols) {
    const { start, end } = symbol.range;
    if (
      (position.line > start.line ||
        (position.line === start.line && position.character >= start.character)) &&
      (position.line < end.line ||
        (position.line === end.line && position.character < end.character))
    )
      return [symbol, ...scopesAt(symbol.children ?? [], position)];
  }
  return [];
}

function workspacePath(root: string, file: string) {
  const path = relative(root, file);
  return path === '..' || path.startsWith('../') || isAbsolute(path) ? undefined : path;
}

async function moduleName(root: string, file: string) {
  const packages: string[] = [];
  for (let folder = dirname(file); folder !== dirname(folder); folder = dirname(folder)) {
    const initializers = await Promise.all(
      ['__init__.py', '__init__.pyi'].map((name) =>
        access(join(folder, name)).then(
          () => true,
          () => false,
        ),
      ),
    );
    if (!initializers.some(Boolean)) break;
    packages.unshift(basename(folder));
  }
  if (packages.length)
    return [
      ...packages,
      ...(/^__init__\.pyi?$/.test(basename(file)) ? [] : [basename(file).replace(/\.pyi?$/, '')]),
    ].join('.');
  const local = workspacePath(root, file);
  const path =
    local === undefined
      ? file.split(/\/(?:site-packages|dist-packages|stdlib)\//).at(-1)!
      : local.replace(/^src\//, '');
  const name = (isAbsolute(path) ? basename(path) : path)
    .replace(/\.pyi?$/, '')
    .replace(/(^|\/)__init__$/, '')
    .replaceAll('/', '.');
  return name || basename(root);
}

export class PythonService {
  private pending = new Map<string, AbortController>();
  constructor(
    private languages: LanguageServers,
    private watcher: WorkspaceWatcher,
    private files: FileService,
    private documents: DocumentService,
  ) {}
  async open(session: Session, input: ParsedInput<'lsp.open'>) {
    await within(session.path, input.path);
    this.watcher.observe(session);
    const server = await this.languages.get(session);
    await server.open(input.path, input.text, input.version);
    server.assertCurrent();
    return { generation: server.generation, value: null };
  }
  async closeDocument(session: Session, path: string) {
    await this.languages.documentClose(session.id, path);
    return null;
  }
  cancel(session: Session, requestId: string) {
    this.pending.get(`${session.id}:${requestId}`)?.abort(new Error('Python request cancelled.'));
    return null;
  }
  private async cancellable<T>(
    session: Session,
    requestId: string | undefined,
    run: (signal?: AbortSignal) => Promise<T>,
  ) {
    if (!requestId) return run();
    const key = `${session.id}:${requestId}`;
    if (this.pending.has(key)) throw new Error('Duplicate Python request.');
    if (this.pending.size >= 128) throw new Error('Python request queue is full.');
    const controller = new AbortController();
    this.pending.set(key, controller);
    try {
      const value = await run(controller.signal);
      controller.signal.throwIfAborted();
      return value;
    } finally {
      this.pending.delete(key);
    }
  }
  request(session: Session, input: ParsedInput<'lsp.request'>) {
    return this.cancellable(session, input.requestId, async (signal) => {
      const document = input.params.textDocument;
      const uri =
        typeof document === 'object' && document !== null && 'uri' in document
          ? document.uri
          : undefined;
      if (typeof uri === 'string') {
        const file = fileURLToPath(uri);
        const rel = relative(session.path, file);
        await within(session.path, rel);
      }
      signal?.throwIfAborted();
      const server = await this.languages.get(session);
      const value = await server.request(input.method, input.params, signal);
      return { generation: server.generation, value };
    });
  }

  private async definitions(
    session: Session,
    input: ParsedInput<'python.hover'>,
    server: Awaited<ReturnType<LanguageServers['get']>>,
    signal?: AbortSignal,
    symbols = new Map<string, Promise<Symbol[]>>(),
  ): Promise<PythonDefinition[]> {
    const file = await within(session.path, input.path);
    const result: Definition[] | Definition | null = await server.request(
      'textDocument/definition',
      {
        textDocument: { uri: pathToFileURL(file).href },
        position: input.position,
      },
      signal,
    );
    return Promise.all(
      (Array.isArray(result) ? result : result ? [result] : []).slice(0, 10).map(async (target) => {
        const uri = 'uri' in target ? target.uri : target.targetUri;
        const selection = 'range' in target ? target.range : target.targetSelectionRange;
        const position = selection.start;
        const isModule =
          position.line === 0 &&
          position.character === 0 &&
          selection.end.line === 0 &&
          selection.end.character === 0;
        if (!isModule && !symbols.has(uri))
          symbols.set(
            uri,
            server
              .request('textDocument/documentSymbol', { textDocument: { uri } }, signal)
              .then((value) => value ?? []),
          );
        const scopes = isModule ? [] : scopesAt(await symbols.get(uri)!, position);
        const scope = scopes.at(-1);
        const name = await moduleName(session.path, fileURLToPath(uri));
        return {
          module: { uri, position: { line: 0, character: 0 }, name, kind: 2 },
          containers: scopes.slice(0, -1).map((symbol) => ({
            uri,
            position: (symbol.selectionRange ?? symbol.range).start,
            name: symbol.name,
            kind: symbol.kind,
          })),
          symbol: { uri, position, name: scope?.name ?? name, kind: scope?.kind ?? 2 },
        };
      }),
    );
  }

  hover(session: Session, input: ParsedInput<'python.hover'>) {
    return this.cancellable(session, input.requestId, async (signal) => {
      const file = await within(session.path, input.path);
      signal?.throwIfAborted();
      const server = await this.languages.get(session);
      const hover = await server.request(
        'textDocument/hover',
        {
          textDocument: { uri: pathToFileURL(file).href },
          position: input.position,
        },
        signal,
      );
      const value = !hover
        ? null
        : {
            markdown: hover.contents.value,
            range: hover.range,
            definitions: await this.definitions(session, input, server, signal).catch(() => []),
          };
      server.assertCurrent();
      return { generation: server.generation, value };
    });
  }

  source(session: Session, input: ParsedInput<'python.source'>) {
    return this.cancellable(session, input.requestId, async (signal) => {
      const server = await this.languages.get(session);
      const symbols = new Map<string, Promise<Symbol[]>>();
      const definitions = await this.definitions(session, input, server, signal, symbols);
      signal?.throwIfAborted();
      const allowed = definitions.flatMap((definition) => [
        definition.module,
        ...definition.containers,
        definition.symbol,
      ]);
      if (
        !allowed.some(
          (target) =>
            target.uri === input.target.uri &&
            target.position.line === input.target.position.line &&
            target.position.character === input.target.position.character,
        )
      )
        throw new Error('This definition is no longer available. Hover the symbol again.');
      const file = fileURLToPath(input.target.uri);
      const path = workspacePath(session.path, file);
      const data =
        path === undefined
          ? await this.files.read({ ...session, path: dirname(file) }, basename(file))
          : await this.documents.read(session, { sessionId: session.id, path, diskOnly: false });
      const outline: Symbol[] = await (
        symbols.get(input.target.uri) ??
        server.request(
          'textDocument/documentSymbol',
          { textDocument: { uri: input.target.uri } },
          signal,
        )
      ).catch(() => []);
      server.assertCurrent();
      return {
        generation: server.generation,
        value: { text: data.text, path: file, workspacePath: path, symbols: outline ?? [] },
      };
    });
  }

  format(session: Session, text: string) {
    return command('ruff', ['format', '--stdin-filename', 'document.py', '-'], {
      cwd: session.path,
      input: text,
    });
  }
}
