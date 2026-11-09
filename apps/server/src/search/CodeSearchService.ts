import {
  searchRepository,
  searchTypes,
  type ParsedInput,
  type SearchMatch,
  type Session,
} from '@superfluid/contracts';
import type { PythonService } from '../python/PythonService';
import type { RepositoryService } from '../vcs/RepositoryService';
import type { SearchService } from './SearchService';
import type { DocumentService } from '../files/DocumentService';
import { compareSearchHits } from './relevance';

const fileType = (path: string) =>
  /\.(?:md|mdx|rst|txt|adoc|asciidoc|org)$/i.test(path) ? 'document' : 'file';

export class CodeSearchService {
  private pending = new Map<string, AbortController>();
  constructor(
    private text: SearchService,
    private python: PythonService,
    private repositories: RepositoryService,
    private documents: DocumentService,
  ) {}
  async preview(session: Session, input: ParsedInput<'search.preview'>) {
    const document = await this.documents.read(session, {
      ...input,
      diskOnly: false,
    });
    const lines = document.text.split('\n');
    const start = Math.max(0, Math.min(lines.length - 1, (input.line ?? 1) - 1) - 8);
    return {
      startLine: start + 1,
      text: lines
        .slice(start, start + 48)
        .map((line) => [...line].slice(0, 400).join(''))
        .join('\n'),
    };
  }
  cancel(session: Session, requestId: string) {
    this.pending.get(`${session.id}:${requestId}`)?.abort(new Error('Search cancelled.'));
    this.text.cancel(session.id, requestId);
    this.text.cancel(session.id, requestId + ':files');
    this.text.cancel(session.id, requestId + ':documents');
    this.python.cancel(session, requestId);
    return null;
  }
  async query(session: Session, input: ParsedInput<'search.query'>) {
    const key = `${session.id}:${input.requestId}`;
    if (this.pending.has(key)) throw new Error('Duplicate search request.');
    if (this.pending.size >= 128) throw new Error('Search queue is full.');
    const controller = new AbortController();
    this.pending.set(key, controller);
    try {
      const result = await this.run(session, input, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      this.pending.delete(key);
    }
  }
  close() {
    for (const controller of this.pending.values()) controller.abort();
  }
  private async run(session: Session, input: ParsedInput<'search.query'>, signal: AbortSignal) {
    const repositories = await this.repositories.list(session);
    signal.throwIfAborted();
    const selected = input.repositoryIds && new Set(input.repositoryIds);
    if (selected && [...selected].some((id) => !repositories.some((r) => r.id === id)))
      throw new Error('A selected repository is unavailable. Refresh repositories.');
    const types = new Set(input.types.length ? input.types : searchTypes);
    const include = (path: string) =>
      !selected || selected.has(searchRepository(path, repositories)?.id ?? '');
    const hits: SearchMatch[] = [];
    const warnings: string[] = [];
    if (!input.query.trim() || selected?.size === 0) return { hits, truncated: false, warnings };
    const tasks: { name: string; run: Promise<{ hits: SearchMatch[]; truncated: boolean }> }[] = [];
    if (types.has('class') || types.has('symbol'))
      tasks.push({
        name: 'Symbols',
        run: this.python
          .symbols(
            session,
            input,
            (path, kind) => include(path) && types.has(kind === 5 ? 'class' : 'symbol'),
          )
          .then(({ value }) => ({
            ...value,
            hits: value.hits.map((hit) => ({
              ...hit,
              type: hit.kind === 5 ? 'class' : ('symbol' as const),
            })),
          })),
      });
    if (types.has('file') || types.has('document'))
      tasks.push({
        name: 'Files',
        run: this.text
          .files(
            session,
            input.query,
            input.requestId + ':files',
            (path) => include(path) && types.has(fileType(path)),
          )
          .then((value) => ({
            ...value,
            hits: value.hits.map((hit) => ({ ...hit, type: fileType(hit.path) })),
          })),
      });
    if (types.has('document'))
      tasks.push({
        name: 'Documents',
        run: this.text
          .text(
            session,
            input.query,
            input.requestId + ':documents',
            (path) => include(path) && fileType(path) === 'document',
          )
          .then((value) => ({
            ...value,
            hits: value.hits.map((hit) => ({ ...hit, type: 'document' as const })),
          })),
      });
    if (types.has('text'))
      tasks.push({
        name: 'Text',
        run: this.text
          .text(
            session,
            input.query,
            input.requestId,
            (path) => include(path) && (!types.has('document') || fileType(path) !== 'document'),
          )
          .then((value) => ({
            ...value,
            hits: value.hits.map((hit) => ({ ...hit, type: 'text' as const })),
          })),
      });
    const results = await Promise.allSettled(tasks.map((task) => task.run));
    let truncated = false;
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        warnings.push(`${tasks[index].name}: ${String(result.reason?.message ?? result.reason)}`);
      } else {
        truncated ||= result.value.truncated;
        hits.push(...result.value.hits);
      }
    }
    if (results.every((result) => result.status === 'rejected'))
      throw new Error(warnings.join('\n'));
    const documentContent = new Set(
      hits
        .filter((hit) => hit.type === 'document' && hit.text !== undefined)
        .map((hit) => hit.path),
    );
    const ranked = hits
      .filter(
        (hit) =>
          hit.type !== 'document' || hit.text !== undefined || !documentContent.has(hit.path),
      )
      .sort(compareSearchHits(input.query));
    return {
      hits: ranked
        .slice(0, 500)
        .map((hit) => ({ ...hit, repositoryId: searchRepository(hit.path, repositories)?.id })),
      truncated: truncated || ranked.length > 500,
      warnings,
    };
  }
}
