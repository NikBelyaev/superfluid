import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, isAbsolute, relative, join } from 'node:path';
import { access } from 'node:fs/promises';
import type {
  Session,
  ParsedInput,
  PythonDefinition,
  PythonLocation,
  PythonUnusedImport,
  PythonImport,
  SearchHit,
} from '@superfluid/contracts';
import { z } from 'zod';
import { LanguageServers } from './LanguageServers';
import { WorkspaceWatcher } from '../workspace/WorkspaceWatcher';
import { within } from '../files/paths';
import { command } from '../process/ProcessRunner';
import { FileService } from '../files/FileService';
import { DocumentService } from '../files/DocumentService';
import { excludedSearchPath } from '../files/searchPaths';
import { compareSearchHits } from '../search/relevance';
import { Gate } from '../utils/Gate';

const ruff =
  process.env.SF_RUFF_PATH ||
  fileURLToPath(
    new URL(`../../../../dist/ruff${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url),
  );

const symbolInformation = z.object({
  name: z.string(),
  containerName: z.string().optional(),
  kind: z.number().int().min(1).max(26),
  location: z.object({
    uri: z.string(),
    range: z.object({
      start: z.object({ line: z.number().int().min(0), character: z.number().int().min(0) }),
    }),
  }),
});

const ruffPosition = z.object({ row: z.number().int().min(1), column: z.number().int().min(1) });
const ruffDiagnostics = z.array(
  z.object({
    code: z.string().nullable(),
    message: z.string(),
    location: ruffPosition,
    end_location: ruffPosition,
  }),
);

const lspPosition = z.object({ line: z.number().int().min(0), character: z.number().int().min(0) });
const lspRange = z.object({ start: lspPosition, end: lspPosition });
const importDiagnostics = z.object({
  items: z.array(z.looseObject({ code: z.string().optional(), range: lspRange })),
});
const importActions = z.array(
  z.object({
    title: z.string(),
    edit: z
      .object({
        changes: z.record(
          z.string(),
          z.array(z.object({ range: lspRange, newText: z.string().max(2 * 1024 * 1024) })).max(100),
        ),
      })
      .optional(),
  }),
);

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
    const [, value] = await Promise.all([
      server.open(input.path, input.text, input.version),
      // Invalid Ruff settings must not disable Python language services.
      this.unusedImports(session, { ...input, text: input.text.replace(/^\uFEFF/, '') }).catch(
        () => [],
      ),
    ]);
    server.assertCurrent();
    return { generation: server.generation, value };
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
      if (input.method === 'completionItem/resolve' && typeof uri !== 'string')
        throw new Error('Completion resolution requires a workspace document.');
      if (typeof uri === 'string') {
        const file = fileURLToPath(uri);
        const rel = relative(session.path, file);
        await within(session.path, rel);
      }
      signal?.throwIfAborted();
      const server = await this.languages.get(session);
      const params = { ...input.params };
      if (input.method === 'completionItem/resolve') delete params.textDocument;
      const value = await server.request(input.method, params, signal);
      return { generation: server.generation, value };
    });
  }

  symbols(
    session: Session,
    input: ParsedInput<'python.symbols'>,
    include: (path: string, kind: number) => boolean = () => true,
  ) {
    return this.cancellable(session, input.requestId, async (signal) => {
      this.watcher.observe(session);
      const server = await this.languages.get(session);
      const result: unknown = await server.request(
        'workspace/symbol',
        { query: input.query },
        signal,
      );
      if (result !== null && !Array.isArray(result))
        throw new Error('Python returned invalid symbols.');
      const candidates: SearchHit[] = [];
      const seen = new Set<string>();
      for (const raw of result ?? []) {
        signal?.throwIfAborted();
        const parsed = symbolInformation.safeParse(raw);
        if (!parsed.success || !parsed.data.location.uri.startsWith('file:')) continue;
        const symbol = parsed.data;
        const path = workspacePath(session.path, fileURLToPath(symbol.location.uri));
        if (path === undefined || excludedSearchPath(path) || !include(path, symbol.kind)) continue;
        const position = symbol.location.range.start;
        const key = `${path}:${position.line}:${position.character}:${symbol.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          path,
          line: position.line + 1,
          column: position.character + 1,
          name: symbol.name.slice(0, 500),
          ...([6, 9].includes(symbol.kind) && symbol.containerName
            ? { containerName: symbol.containerName.slice(0, 500) }
            : {}),
          kind: symbol.kind,
        });
      }
      const hits: SearchHit[] = [];
      for (const hit of candidates.sort(compareSearchHits(input.query))) {
        signal?.throwIfAborted();
        if (
          !(await within(session.path, hit.path).then(
            () => true,
            () => false,
          ))
        )
          continue;
        hits.push(hit);
        if (hits.length > 500) break;
      }
      const outlines = new Map<string, Promise<Symbol[]>>();
      const enrichment = new Gate(4, 500);
      await Promise.all(
        hits
          .slice(0, 500)
          .filter((hit) => [6, 9].includes(hit.kind!) && !hit.containerName)
          .map((hit) =>
            enrichment.run(async () => {
              signal?.throwIfAborted();
              const uri = pathToFileURL(join(session.path, hit.path)).href;
              if (!outlines.has(uri))
                outlines.set(
                  uri,
                  server.symbolOutline(uri, signal).then((value) => value ?? []),
                );
              const containers = scopesAt(await outlines.get(uri)!, {
                line: hit.line! - 1,
                character: hit.column! - 1,
              })
                .filter((symbol) => symbol.kind === 5)
                .map((symbol) => symbol.name);
              if (containers.length) hit.containerName = containers.join('.').slice(0, 500);
            }),
          ),
      );
      server.assertCurrent();
      return {
        generation: server.generation,
        value: { hits: hits.slice(0, 500), truncated: hits.length > 500 },
      };
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
        const binding =
          scope?.selectionRange &&
          (position.line !== scope.selectionRange.start.line ||
            position.character !== scope.selectionRange.start.character);
        const name = await moduleName(session.path, fileURLToPath(uri));
        return {
          module: { uri, position: { line: 0, character: 0 }, name, kind: 2 },
          containers: scopes.slice(0, -1).map((symbol) => ({
            uri,
            position: (symbol.selectionRange ?? symbol.range).start,
            name: symbol.name,
            kind: symbol.kind,
          })),
          symbol: {
            uri,
            position,
            range: selection,
            name: scope?.name ?? name,
            kind: scope?.kind ?? 2,
          },
          ...(binding ? { binding: true } : {}),
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
    return command(ruff, ['format', '--stdin-filename', 'document.py', '-'], {
      cwd: session.path,
      input: text,
    });
  }

  imports(session: Session, input: ParsedInput<'python.imports'>) {
    return this.cancellable(session, input.requestId, async (signal) => {
      const file = await within(session.path, input.path);
      signal?.throwIfAborted();
      this.watcher.observe(session);
      const primary = await this.languages.get(session);
      const server = await primary.importServer(input.path, input.text, input.version);
      const textDocument = { uri: pathToFileURL(file).href };
      const request = async (method: string, params: object) => {
        try {
          return await server.request(method, params, signal);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === -32801)) throw error;
          signal?.throwIfAborted();
          primary.assertCurrent();
          // ty can invalidate a read while watched drafts change; read the current revision once.
          return server.request(method, params, signal);
        }
      };
      const report = importDiagnostics.parse(
        await request('textDocument/diagnostic', { textDocument }),
      );
      const p = input.position;
      const diagnostics = report.items.filter(
        ({ code, range: { start, end } }) =>
          code === 'unresolved-reference' &&
          (p.line > start.line || (p.line === start.line && p.character >= start.character)) &&
          (p.line < end.line || (p.line === end.line && p.character <= end.character)),
      );
      const value: PythonImport[] = [];
      if (diagnostics.length) {
        const actions = importActions.parse(
          await request('textDocument/codeAction', {
            textDocument,
            range: { start: p, end: p },
            context: { diagnostics, only: ['quickfix'], triggerKind: 1 },
          }),
        );
        for (const action of actions) {
          const changes = action.edit?.changes;
          if (
            !action.title.startsWith('import ') ||
            !changes ||
            Object.keys(changes).some((uri) => uri !== textDocument.uri)
          )
            continue;
          const edits = changes[textDocument.uri];
          if (edits?.length) value.push({ title: action.title, edits });
          if (value.length === 50) break;
        }
      }
      primary.assertCurrent();
      return { generation: primary.generation, value };
    });
  }

  async unusedImports(
    session: Session,
    input: ParsedInput<'python.organizeImports'>,
  ): Promise<PythonUnusedImport[]> {
    const file = await within(session.path, input.path);
    const output = await command(
      ruff,
      [
        'check',
        '--select',
        'F401',
        '--no-fix',
        '--no-cache',
        '--output-format',
        'json',
        '--stdin-filename',
        file,
        '-',
      ],
      { cwd: session.path, input: input.text, accept: [1] },
    );
    const lines = input.text.split('\n');
    // Ruff counts Unicode code points; Monaco positions count UTF-16 code units.
    const position = ({ row, column }: z.infer<typeof ruffPosition>) => ({
      line: row - 1,
      character: Array.from(lines[row - 1] ?? '')
        .slice(0, column - 1)
        .join('').length,
    });
    return ruffDiagnostics
      .parse(JSON.parse(output))
      .filter((d) => d.code === 'F401')
      .map((d) => ({
        range: { start: position(d.location), end: position(d.end_location) },
        message: d.message,
      }));
  }

  async organizeImports(session: Session, input: ParsedInput<'python.organizeImports'>) {
    const file = await within(session.path, input.path);
    return command(
      ruff,
      [
        'check',
        '--select',
        'F401,I001',
        '--fix-only',
        '--no-unsafe-fixes',
        '--no-cache',
        '--stdin-filename',
        file,
        '-',
      ],
      { cwd: session.path, input: input.text },
    );
  }
}
