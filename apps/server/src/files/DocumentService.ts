import { resolve } from 'node:path';
import type { Session, ParsedInput } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { FileService } from './FileService';
import { logicalPath, within } from './paths';

import { assertNoDrafts } from './drafts';
import { WorkspaceWatcher } from '../workspace/WorkspaceWatcher';

export class DocumentService {
  constructor(
    private files: FileService,
    private store: Store,
    private watcher: WorkspaceWatcher,
  ) {}
  list(session: Session, path: string) {
    this.watcher.observe(session);
    return this.files.list(session, path);
  }
  async read(session: Session, input: ParsedInput<'files.read'>) {
    this.watcher.observe(session);
    logicalPath(session.path, input.path);
    const draft = input.diskOnly ? undefined : this.store.getDraft(session.id, input.path);
    if (!draft) return this.files.read(session, input.path);
    const disk = await this.files.read(session, input.path).catch(() => undefined);
    return {
      path: input.path,
      text: draft.text,
      diskText: disk?.text,
      hash: draft.hash,
      recovered: true,
      version: draft.version,
    };
  }

  async rename(session: Session, path: string, target: string) {
    assertNoDrafts(this.store, session, path);
    await this.files.rename(session, path, target);
    return null;
  }
  async resolve(session: Session, path: string) {
    assertNoDrafts(this.store, session, path);
    await within(session.path, path);
    return resolve(session.path, path);
  }
  putDraft(session: Session, input: ParsedInput<'draft.put'>) {
    if (!input.path) throw new Error('Choose a file path.');
    logicalPath(session.path, input.path);
    if (Buffer.byteLength(input.text) > 2 * 1024 * 1024)
      throw new Error('This recovery document exceeds 2 MiB.');
    return this.store.draft(input);
  }
}
