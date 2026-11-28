import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  goCompletion,
  goHover,
  goRange,
  type ParsedInput,
  type Session,
} from '@superfluid/contracts';
import { within } from '../files/paths';
import type { LanguageServers } from '../python/LanguageServers';
import type { WorkspaceWatcher } from '../workspace/WorkspaceWatcher';

const location = z.object({ uri: z.string(), range: goRange });
const completionList = z.object({ items: z.array(z.unknown()), isIncomplete: z.boolean() });

export class GoService {
  private pending = new Map<string, AbortController>();

  constructor(
    private languages: LanguageServers,
    private watcher: WorkspaceWatcher,
  ) {}

  async sync(session: Session, input: ParsedInput<'go.sync'>) {
    await within(session.path, input.path, true);
    this.watcher.observe(session);
    const server = await this.languages.get(session, 'go');
    await server.open(input.path, input.text, input.version);
    server.assertCurrent();
    return server.generation;
  }

  async close(session: Session, path: string) {
    await this.languages.documentClose(session.id, path, 'go');
    return null;
  }

  cancel(session: Session, requestId: string) {
    this.pending.get(`${session.id}:${requestId}`)?.abort(new Error('Go request cancelled.'));
    return null;
  }

  private async request(
    session: Session,
    input: ParsedInput<'go.completion'>,
    method: 'completion' | 'hover' | 'definition',
  ): Promise<unknown> {
    const key = `${session.id}:${input.requestId}`;
    if (this.pending.has(key)) throw new Error('Duplicate Go request.');
    if (this.pending.size >= 128) throw new Error('Go request queue is full.');
    const controller = new AbortController();
    this.pending.set(key, controller);
    const { signal } = controller;
    try {
      await within(session.path, input.path, true);
      signal.throwIfAborted();
      const server = this.languages.goServer(session.id, input.generation);
      return await server.request(
        `textDocument/${method}`,
        {
          textDocument: { uri: pathToFileURL(join(session.path, input.path)).href },
          position: input.position,
        },
        signal,
      );
    } finally {
      this.pending.delete(key);
    }
  }

  async completion(session: Session, input: ParsedInput<'go.completion'>) {
    const result = await this.request(session, input, 'completion');
    const list = completionList.safeParse(result).data;
    const items = Array.isArray(result) ? result : (list?.items ?? []);
    return {
      items: items.slice(0, 300).flatMap((item) => {
        const parsed = goCompletion.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
      isIncomplete: list?.isIncomplete ?? false,
    };
  }

  async hover(session: Session, input: ParsedInput<'go.hover'>) {
    const result = await this.request(session, input, 'hover');
    return goHover.safeParse(result).data ?? null;
  }

  async definition(session: Session, input: ParsedInput<'go.definition'>) {
    const result = await this.request(session, input, 'definition');
    const targets = [];
    for (const item of (Array.isArray(result) ? result : [result]).slice(0, 100)) {
      const parsed = location.safeParse(item);
      if (!parsed.success || !parsed.data.uri.startsWith('file:')) continue;
      const file = fileURLToPath(parsed.data.uri);
      const path = relative(session.path, file);
      if (isAbsolute(path) || !path.endsWith('.go')) continue;
      if (await within(session.path, path).catch(() => undefined))
        targets.push({ path, range: parsed.data.range });
    }
    return targets;
  }
}
