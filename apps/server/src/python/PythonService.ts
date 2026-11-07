import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, isAbsolute, relative, join } from 'node:path';
import { access } from 'node:fs/promises';
import type {
  Session,
  ParsedInput,
  PythonDefinition,
  PythonHover,
  PythonLocation,
} from '@superfluid/contracts';
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
  constructor(
    private languages: LanguageServers,
    private watcher: WorkspaceWatcher,
    private files: FileService,
    private documents: DocumentService,
  ) {}
  async open(session: Session, input: ParsedInput<'lsp.open'>) {
    await within(session.path, input.path);
    this.watcher.observe(session);
    await (await this.languages.get(session)).open(input.path, input.text, input.version);
    return null;
  }
  async closeDocument(session: Session, path: string) {
    await (await this.languages.get(session)).documentClose(path);
    return null;
  }
  async request(session: Session, input: ParsedInput<'lsp.request'>) {
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
    return await (await this.languages.get(session)).request(input.method, input.params);
  }

  private async definitions(
    session: Session,
    input: ParsedInput<'python.hover'>,
  ): Promise<PythonDefinition[]> {
    const file = await within(session.path, input.path);
    const server = await this.languages.get(session);
    const result: Definition[] | Definition | null = await server.request(
      'textDocument/definition',
      {
        textDocument: { uri: pathToFileURL(file).href },
        position: input.position,
      },
    );
    const symbols = new Map<string, Promise<Symbol[]>>();
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
              .request('textDocument/documentSymbol', { textDocument: { uri } })
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

  async hover(session: Session, input: ParsedInput<'python.hover'>): Promise<PythonHover | null> {
    const file = await within(session.path, input.path);
    const server = await this.languages.get(session);
    const hover = await server.request('textDocument/hover', {
      textDocument: { uri: pathToFileURL(file).href },
      position: input.position,
    });
    if (!hover) return null;
    return {
      markdown: hover.contents.value,
      range: hover.range,
      definitions: await this.definitions(session, input).catch(() => []),
    };
  }

  async source(session: Session, input: ParsedInput<'python.source'>) {
    const definitions = await this.definitions(session, input);
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
    return { text: data.text, path: file, workspacePath: path };
  }

  format(session: Session, text: string) {
    return command('ruff', ['format', '--stdin-filename', 'document.py', '-'], {
      cwd: session.path,
      input: text,
    });
  }
}
