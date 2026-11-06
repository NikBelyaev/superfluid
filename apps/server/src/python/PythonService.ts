import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import type { Session, ParsedInput } from '@superfluid/contracts';
import { LanguageServers } from './LanguageServers';
import { WorkspaceWatcher } from '../workspace/WorkspaceWatcher';
import { within } from '../files/paths';
import { command } from '../process/ProcessRunner';

export class PythonService {
  constructor(
    private languages: LanguageServers,
    private watcher: WorkspaceWatcher,
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

  format(session: Session, text: string) {
    return command('ruff', ['format', '--stdin-filename', 'document.py', '-'], {
      cwd: session.path,
      input: text,
    });
  }
}
