import { watch, type FSWatcher } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Draft, FileResults, Session } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { FileService } from '../files/FileService';
import { logicalPath } from '../files/paths';
import { Gate } from '../utils/Gate';
import { excludedSearchPath } from '../files/searchPaths';
import { z } from 'zod';
import { Zoekt, searchResult } from './Zoekt';
import { compareSearchHits } from './relevance';

type SearchResult = FileResults['files.search'];

class SearchSession {
  readonly ready: Promise<void>;
  private worker?: Zoekt;
  private directory?: string;
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private building?: Promise<void>;
  private listing?: Promise<void>;
  private paths = new Set<string>();
  private indexed = new Set<string>();
  private hasIndex = false;
  private changes = new Map<string, number>();
  private version = 0;
  private needsListing = true;
  private closed = false;
  private error?: Error;
  active = 0;
  constructor(
    readonly session: Session,
    private cache: string,
    private files: FileService,
    private builds: Gate,
  ) {
    this.ready = this.start();
    this.ready.catch(() => {});
  }
  get available() {
    return !this.closed && !this.error && (this.worker?.available ?? true);
  }
  changed(path = '', event: 'rename' | 'change' = 'rename') {
    if (process.platform === 'win32') path = path.replaceAll('\\', '/');
    if (this.closed || excludedSearchPath(path)) return;
    this.changes.set(path, ++this.version);
    if (event === 'rename' || !this.paths.has(path) || /(?:^|\/)\.(?:gitignore|ignore)$/.test(path))
      this.needsListing = true;
    if (!this.hasIndex && !this.building) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.ready
        .then(() => this.rebuild())
        .catch((error: Error) => {
          this.error = error;
        });
    }, 500);
  }
  private async start() {
    await mkdir(this.cache, { recursive: true, mode: 0o700 });
    this.directory = await mkdtemp(join(this.cache, 'worktree-'));
    if (this.closed) return;
    this.worker = new Zoekt(this.session.path, this.directory);
    this.watcher = watch(this.session.path, { recursive: true }, (event, path) =>
      this.changed(path ?? '', event),
    );
    this.watcher.on('error', (error) => {
      this.error = error;
      this.watcher?.close();
    });
    await this.list();
  }
  private async list() {
    if (this.listing) await this.listing;
    if (!this.needsListing) return;
    this.needsListing = false;
    this.listing = (async () => {
      this.paths = new Set(z.array(z.string()).parse(await this.worker!.request('files')));
    })();
    try {
      await this.listing;
    } finally {
      this.listing = undefined;
    }
    if (this.needsListing) await this.list();
  }
  private async rebuild() {
    if (this.building) return this.building;
    if (this.closed) return;
    this.building = this.builds.run(async () => {
      if (this.closed) return;
      await this.list();
      const version = this.version;
      const paths = new Set(this.paths);
      await this.worker!.request('index', { paths: [...paths] });
      this.indexed = paths;
      this.hasIndex = true;
      for (const [path, changed] of this.changes) if (changed <= version) this.changes.delete(path);
    });
    try {
      await this.building;
    } finally {
      this.building = undefined;
      if (!this.closed && this.changes.size && !this.timer)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.rebuild().catch((error: Error) => {
            this.error = error;
          });
        }, 500);
    }
  }
  async search(
    query: string,
    drafts: Draft[],
    signal?: AbortSignal,
    include: (path: string) => boolean = () => true,
    mode: 'text' | 'file' = 'text',
  ): Promise<SearchResult> {
    await this.ready;
    signal?.throwIfAborted();
    if (this.error) throw this.error;
    await this.list();
    if (mode === 'file') {
      const needle = query.toLowerCase();
      const matches = [...this.paths]
        .filter((path) => include(path) && path.toLowerCase().includes(needle))
        .map((path) => ({ path }))
        .sort(compareSearchHits(query));
      return {
        hits: matches.slice(0, 500),
        truncated: matches.length > 500,
      };
    }
    const prefixes = [...this.changes.keys()].filter(
      (path) => !this.paths.has(path) && !this.indexed.has(path),
    );
    const changed = (path: string) =>
      this.changes.has(path) || prefixes.some((p) => !p || path.startsWith(p + '/'));
    const buffers = new Map(
      drafts.filter((d) => !excludedSearchPath(d.path)).map((d) => [d.path, d.text]),
    );
    const exclude = new Set(
      [...this.indexed].filter(
        (path) => !include(path) || !this.paths.has(path) || changed(path) || buffers.has(path),
      ),
    );
    const overlay = new Set([...this.paths].filter(changed));
    for (const path of buffers.keys()) {
      overlay.add(path);
    }
    for (const path of overlay) exclude.add(path);
    const hits: SearchResult['hits'] = [];
    for (const path of overlay) {
      signal?.throwIfAborted();
      if (!include(path)) continue;
      logicalPath(this.session.path, path);
      let text = buffers.get(path);
      if (text === undefined) {
        const file = await this.files
          .read(this.session, path)
          .catch((error: Error & { code?: string }) => {
            if (
              ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code ?? '') ||
              /binary|too large|outside/.test(error.message)
            )
              return undefined;
            throw error;
          });
        text = file?.text;
      }
      if (text === undefined) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && hits.length <= 500; i++) {
        const column = lines[i].indexOf(query);
        if (column >= 0) {
          const start = Math.max(
            0,
            [...lines[i].slice(0, column)].length - Math.min(40, 500 - [...query].length),
          );
          hits.push({
            path,
            line: i + 1,
            column: column + 1,
            text: [...lines[i].replace(/\r$/, '')].slice(start, start + 500).join(''),
          });
        }
      }
      if (hits.length > 500) break;
    }
    signal?.throwIfAborted();
    const indexed = this.hasIndex;
    const pending =
      hits.length > 500
        ? Promise.resolve({ hits: [], truncated: true })
        : this.worker!.request(
            indexed ? 'search' : 'scan',
            {
              query,
              exclude: [...exclude],
              ...(indexed ? {} : { paths: [...this.paths].filter(include) }),
            },
            signal,
          );
    if (!this.hasIndex && !this.closed)
      void this.rebuild().catch((error: Error) => {
        this.error = error;
      });
    const result = searchResult.parse(await pending);
    signal?.throwIfAborted();
    return {
      hits: [...hits, ...result.hits].slice(0, 500),
      truncated: result.truncated || hits.length + result.hits.length > 500,
    };
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    await this.worker?.close();
    await this.ready.catch(() => {});
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}

export class SearchService {
  private closed = false;
  private cacheReady: Promise<void>;
  private sessions = new Map<string, SearchSession>();
  private builds = new Gate(1, 4);
  private queries = new Gate(2, 8);
  private lifecycle = new Gate(1, 128);
  private pending = new Map<string, AbortController>();
  constructor(
    private store: Store,
    private fileIO: FileService,
  ) {
    this.cacheReady = rm(join(store.directory, 'search'), { recursive: true, force: true });
    this.cacheReady.catch(() => {});
  }
  changed(sessionId: string, path?: string, event?: 'rename' | 'change') {
    this.sessions.get(sessionId)?.changed(path, event);
  }
  cancel(sessionId: string, requestId: string) {
    this.pending.get(`${sessionId}:${requestId}`)?.abort(new Error('Search cancelled.'));
    return null;
  }
  async text(
    session: Session,
    query: string,
    requestId?: string,
    include: (path: string) => boolean = () => true,
  ): Promise<SearchResult> {
    return this.query(session, query, requestId, include, 'text');
  }
  files(
    session: Session,
    query: string,
    requestId?: string,
    include: (path: string) => boolean = () => true,
  ) {
    return this.query(session, query, requestId, include, 'file');
  }
  private async query(
    session: Session,
    query: string,
    requestId: string | undefined,
    include: (path: string) => boolean,
    mode: 'text' | 'file',
  ): Promise<SearchResult> {
    if (!query.trim()) return { hits: [], truncated: false };
    if (/[\r\n]/.test(query)) throw new Error('Enter a search query on one line.');
    const key = requestId && `${session.id}:${requestId}`;
    if (key && this.pending.has(key)) throw new Error('Duplicate search request.');
    if (this.pending.size >= 128) throw new Error('Search queue is full.');
    const controller = new AbortController();
    if (key) this.pending.set(key, controller);
    let state: SearchSession | undefined;
    try {
      state = await this.acquire(session, controller.signal);
      controller.signal.throwIfAborted();
      let abort!: () => void;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          abort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once: true });
        });
        await Promise.race([state.ready, cancelled]);
        controller.signal.throwIfAborted();
        const target = state;
        return await this.queries.run(() =>
          Promise.race([
            target.search(
              query,
              mode === 'file' ? [] : this.store.drafts(session.id),
              controller.signal,
              include,
              mode,
            ),
            cancelled,
          ]),
        );
      } finally {
        controller.signal.removeEventListener('abort', abort);
      }
    } finally {
      if (state) state.active--;
      if (key) this.pending.delete(key);
    }
  }
  private acquire(session: Session, signal: AbortSignal) {
    return this.lifecycle.run(async () => {
      await this.cacheReady;
      signal.throwIfAborted();
      if (this.closed) throw new Error('Code search is shutting down.');
      let state = this.sessions.get(session.id);
      if (state && (!state.available || state.session.path !== session.path)) {
        await state.close();
        this.sessions.delete(session.id);
        state = undefined;
      }
      if (!state) {
        if (this.sessions.size >= 2) {
          const idle = [...this.sessions].find(([, item]) => !item.active);
          if (!idle) throw new Error('Search is busy in other worktrees. Try again.');
          this.sessions.delete(idle[0]);
          await idle[1].close();
        }
        if (this.closed) throw new Error('Code search is shutting down.');
        state = new SearchSession(
          { ...session },
          join(this.store.directory, 'search'),
          this.fileIO,
          this.builds,
        );
      }
      this.sessions.delete(session.id);
      this.sessions.set(session.id, state);
      state.active++;
      return state;
    });
  }
  async close() {
    this.closed = true;
    for (const controller of this.pending.values()) controller.abort();
    await this.lifecycle.run(async () => {
      await Promise.all([...this.sessions.values()].map((state) => state.close()));
      this.sessions.clear();
    });
  }
}
