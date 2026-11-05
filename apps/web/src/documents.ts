import * as monaco from 'monaco-editor/editor/editor.api';
// Register contributions before language registration initializes Monaco services.
import 'monaco-editor/editor/browser/coreCommands';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/shell/register';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import type { Session } from '../../../packages/contracts';
import { Recovery } from './recovery';

(self as typeof self & { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
export interface Doc {
  key: string;
  session: Session;
  path: string;
  model: monaco.editor.ITextModel;
  hash: string;
  version: number;
  dirty: boolean;
  recovered: boolean;
  diskText?: string;
  reveal?: { line: number; column: number };
  lspTimer?: ReturnType<typeof setTimeout>;
  lastUsed: number;
  saving?: Promise<void>;
  reloading?: boolean;
  closed?: boolean;
}
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => {
  revision++;
  for (const listener of listeners) listener();
};
export const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export const getRevision = () => revision;
const language = (path: string) =>
  path.endsWith('.py') || path.endsWith('.pyi')
    ? 'python'
    : /\.ya?ml$/.test(path)
      ? 'yaml'
      : path.endsWith('.md')
        ? 'markdown'
        : /\.(sh|zsh)$/.test(path)
          ? 'shell'
          : 'plaintext';

class Documents {
  items = new Map<string, Doc>();
  focused: Doc | null = null;
  private viewReaders = new Set<() => void>();
  registerViewReader(read: () => void) {
    this.viewReaders.add(read);
    return () => {
      this.viewReaders.delete(read);
    };
  }
  captureViews() {
    for (const read of this.viewReaders) read();
  }
  recovery = new Recovery((e) => {
    void import('./state').then(({ useApp }) => useApp.getState().fail(e));
  });
  activeSessions: string[] = [];
  key(sessionId: string, path: string) {
    return `${sessionId}:${path}`;
  }
  uri(s: Session, path: string) {
    return monaco.Uri.from({ scheme: 'superfluid-file', authority: s.id, path: '/' + path });
  }
  diskUri(doc: Doc) {
    return monaco.Uri.file(doc.session.path + '/' + doc.path).toString();
  }
  find(model: monaco.editor.ITextModel) {
    return [...this.items.values()].find((d) => d.model === model);
  }
  async open(session: Session, path: string) {
    const key = this.key(session.id, path),
      existing = this.items.get(key);
    if (existing) {
      existing.closed = false;
      existing.lastUsed = Date.now();
      return existing;
    }
    await this.prune();
    const total = [...this.items.values()].reduce((n, d) => n + d.model.getValueLength() * 2, 0);
    if (this.items.size >= 80 || total >= 128 * 1024 * 1024)
      throw new Error('Editor memory limit reached. Save or close a document first.');
    const data = await window.superfluid.call('files.read', { sessionId: session.id, path });
    const raced = this.items.get(key);
    if (raced) return raced;
    const model = monaco.editor.createModel(data.text, language(path), this.uri(session, path));
    const doc: Doc = {
      key,
      session,
      path,
      model,
      hash: data.hash,
      version: data.version,
      dirty: !!data.recovered,
      recovered: !!data.recovered,
      diskText: data.diskText,
      lastUsed: Date.now(),
    };
    this.items.set(key, doc);
    const source = {
      key,
      version: () => doc.version,
      text: () => model.getValue(undefined, true),
      hash: () => doc.hash,
      write: (version: number, text: string, hash: string) =>
        window.superfluid.call('draft.put', { sessionId: session.id, path, text, hash, version }),
    };
    if (data.recovered) this.recovery.restore(source);
    model.onDidChangeContent(() => {
      if (doc.reloading) return;
      doc.version++;
      const wasDirty = doc.dirty;
      doc.dirty = true;
      this.recovery.changed(source);
      clearTimeout(doc.lspTimer);
      if (model.getLanguageId() === 'python')
        doc.lspTimer = setTimeout(() => void this.sync(doc).catch(() => {}), 200);
      if (!wasDirty) notify();
    });
    if (model.getLanguageId() === 'python') void this.sync(doc).catch(() => {});
    notify();
    return doc;
  }
  async sync(doc: Doc) {
    if (doc.model.isDisposed()) return;
    return window.superfluid.call('lsp.open', {
      sessionId: doc.session.id,
      path: doc.path,
      text: doc.model.getValue(undefined, true),
      version: doc.version,
    });
  }
  async save(doc: Doc): Promise<void> {
    if (doc.saving) return doc.saving;
    doc.saving = this.saveCurrent(doc).finally(() => {
      doc.saving = undefined;
    });
    return doc.saving;
  }
  private async saveCurrent(doc: Doc) {
    await this.recovery.flush(doc.key);
    const version = doc.version,
      text = doc.model.getValue(undefined, true);
    const result = await window.superfluid.call('files.save', {
      sessionId: doc.session.id,
      path: doc.path,
      text,
      hash: doc.hash,
    });
    doc.hash = result.hash;
    await this.recovery.rebase(doc.key);
    await window.superfluid.call('draft.drop', {
      sessionId: doc.session.id,
      path: doc.path,
      version,
    });
    if (doc.version === version) {
      doc.dirty = false;
      doc.recovered = false;
      this.recovery.forget(doc.key);
    }
    notify();
  }
  async reload(doc: Doc) {
    await this.recovery.flush(doc.key);
    const version = doc.version;
    const disk = await window.superfluid.call('files.read', {
      sessionId: doc.session.id,
      path: doc.path,
      diskOnly: true,
    });
    if (doc.version !== version)
      throw new Error('You edited this file while it was reloading. Your current buffer was kept.');
    await window.superfluid.call('draft.drop', {
      sessionId: doc.session.id,
      path: doc.path,
      version,
    });
    if (doc.version !== version) {
      await this.recovery.rebase(doc.key);
      throw new Error('You edited this file while it was reloading. Your current buffer was kept.');
    }
    this.recovery.forget(doc.key);
    doc.hash = disk.hash;
    doc.reloading = true;
    try {
      doc.model.setValue(disk.text);
      doc.version++;
    } finally {
      doc.reloading = false;
    }
    doc.dirty = false;
    doc.recovered = false;
    notify();
    void this.sync(doc).catch(() => {});
  }
  async close(sessionId: string, path: string) {
    const doc = this.items.get(this.key(sessionId, path));
    if (!doc) return;
    if (doc.dirty) await this.recovery.flush(doc.key);
    else await window.superfluid.call('lsp.close', { sessionId, path }).catch(() => {});
    doc.closed = true;
    requestAnimationFrame(() => void this.prune());
  }
  assertClean(sessionId: string, path: string) {
    if (
      [...this.items.values()].some(
        (d) =>
          d.session.id === sessionId &&
          (d.path === path || d.path.startsWith(path + '/')) &&
          d.dirty,
      )
    )
      throw new Error(
        'Save or discard the unsaved files in this path before renaming or deleting it.',
      );
  }
  removePaths(sessionId: string, path: string) {
    if (
      [...this.items.values()].some(
        (d) =>
          d.session.id === sessionId &&
          (d.path === path || d.path.startsWith(path + '/')) &&
          d.dirty,
      )
    )
      throw new Error(
        'A file changed while it was moving. Its unsaved buffer was kept; export it before closing.',
      );
    for (const [key, d] of this.items) {
      if (d.session.id !== sessionId || (d.path !== path && !d.path.startsWith(path + '/')))
        continue;
      clearTimeout(d.lspTimer);
      d.model.dispose();
      this.items.delete(key);
      this.recovery.forget(key);
      if (this.focused === d) this.focused = null;
      void window.superfluid.call('lsp.close', { sessionId, path: d.path }).catch(() => {});
    }
    notify();
  }
  async activate(id: string) {
    this.activeSessions = [id, ...this.activeSessions.filter((x) => x !== id)].slice(0, 3);
    await this.prune();
    requestAnimationFrame(() => void this.prune());
  }
  async prune() {
    for (const [key, d] of this.items) {
      if (
        (this.activeSessions.includes(d.session.id) && !d.closed) ||
        d.saving ||
        d.model.isAttachedToEditor()
      )
        continue;
      if (d.dirty && !this.recovery.durable(key, d.version)) {
        try {
          await this.recovery.flush(key);
        } catch {
          continue;
        }
      }
      if (
        this.items.get(key) !== d ||
        (this.activeSessions.includes(d.session.id) && !d.closed) ||
        d.model.isAttachedToEditor() ||
        (d.dirty && !this.recovery.durable(key, d.version))
      )
        continue;
      clearTimeout(d.lspTimer);
      d.model.dispose();
      this.items.delete(key);
      this.recovery.forget(key);
    }
  }
  async applyWorkspaceEdit(session: Session, edit: any) {
    const changes: any[] =
      edit.documentChanges ??
      Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({
        textDocument: { uri, version: null },
        edits,
      }));
    if (!Array.isArray(changes) || changes.length > 80)
      throw new Error('This refactoring exceeds the 80-document limit.');
    const prepared: {
      doc: Doc;
      before: string;
      version: number;
      edits: monaco.editor.IIdentifiedSingleEditOperation[];
    }[] = [];
    for (const change of changes) {
      if (change.kind || !change.textDocument?.uri)
        throw new Error('This refactoring contains unsupported file operations.');
      const uri = monaco.Uri.parse(change.textDocument.uri),
        root = session.path.replace(/\/$/, '') + '/';
      if (uri.scheme !== 'file' || !uri.fsPath.startsWith(root))
        throw new Error('The refactoring changes a file outside this worktree.');
      const path = uri.fsPath.slice(root.length),
        doc = await this.open(session, path);
      if (!Array.isArray(change.edits) || change.edits.length > 10000)
        throw new Error('Invalid or oversized refactoring.');
      if (change.textDocument.version != null && change.textDocument.version !== doc.version)
        throw new Error('A document changed after the refactoring was prepared. Try again.');
      if (!doc.dirty) {
        const disk = await window.superfluid.call('files.read', {
          sessionId: session.id,
          path,
          diskOnly: true,
        });
        if (disk.hash !== doc.hash)
          throw new Error('A file changed on disk. Reload it before refactoring.');
      }
      const edits: monaco.editor.IIdentifiedSingleEditOperation[] = change.edits.map((e: any) => {
        const p = e.range;
        if (
          typeof e.newText !== 'string' ||
          ![p?.start?.line, p?.start?.character, p?.end?.line, p?.end?.character].every(
            (n) => Number.isInteger(n) && n >= 0,
          )
        )
          throw new Error('Invalid refactoring range.');
        const range = new monaco.Range(
          p.start.line + 1,
          p.start.character + 1,
          p.end.line + 1,
          p.end.character + 1,
        );
        if (!monaco.Range.equalsRange(range, doc.model.validateRange(range)))
          throw new Error('A refactoring range no longer matches this file.');
        return { range, text: e.newText };
      });
      const offsets = edits
        .map((e) => ({
          start: doc.model.getOffsetAt({
            lineNumber: e.range.startLineNumber,
            column: e.range.startColumn,
          }),
          end: doc.model.getOffsetAt({
            lineNumber: e.range.endLineNumber,
            column: e.range.endColumn,
          }),
        }))
        .sort((a, b) => a.start - b.start);
      if (offsets.some((e, i) => i > 0 && e.start < offsets[i - 1].end))
        throw new Error('Overlapping refactoring edits are not supported.');
      prepared.push({
        doc,
        before: doc.model.getValue(undefined, true),
        version: doc.version,
        edits,
      });
    }
    if (prepared.some((p) => p.doc.version !== p.version))
      throw new Error('A document changed while preparing this refactoring. Try again.');
    try {
      for (const p of prepared) {
        p.doc.model.pushStackElement();
        p.doc.model.pushEditOperations([], p.edits, () => null);
        p.doc.model.pushStackElement();
      }
    } catch (e) {
      for (const p of prepared) p.doc.model.setValue(p.before);
      throw e;
    }
    notify();
  }
  async prepareRename(
    session: Session,
    source: { path: string; line: number; column: number },
    newName: string,
  ) {
    const doc = await this.open(session, source.path);
    const sync = async () => {
      const docs = [...this.items.values()].filter((d) => d.session.id === session.id),
        versions = new Map(docs.map((d) => [this.diskUri(d), d.version]));
      await Promise.all(docs.map((d) => this.sync(d)));
      return versions;
    };
    const request = () =>
      window.superfluid.call('lsp.request', {
        sessionId: session.id,
        method: 'textDocument/rename',
        params: {
          textDocument: { uri: this.diskUri(doc) },
          position: { line: source.line - 1, character: source.column - 1 },
          newName,
        },
      });
    const changes = (edit: any): any[] => {
      if (!edit) throw new Error('Python could not rename this symbol.');
      const list =
        edit.documentChanges ??
        Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({
          textDocument: { uri },
          edits,
        }));
      if (!Array.isArray(list) || list.length > 80)
        throw new Error('This rename exceeds the 80-document limit.');
      return list;
    };
    let versions = await sync(),
      edit = await request(),
      loaded = false;
    for (const change of changes(edit)) {
      if (change.kind || !change.textDocument?.uri)
        throw new Error('This rename contains unsupported file operations.');
      const uri = monaco.Uri.parse(change.textDocument.uri),
        root = session.path.replace(/\/$/, '') + '/';
      if (uri.scheme !== 'file' || !uri.fsPath.startsWith(root))
        throw new Error('This rename changes a file outside this worktree.');
      if (!this.items.has(this.key(session.id, uri.fsPath.slice(root.length)))) {
        await this.open(session, uri.fsPath.slice(root.length));
        loaded = true;
      }
    }
    if (loaded) {
      versions = await sync();
      edit = await request();
    }
    const stamped = changes(edit).map((change) => {
      const version = versions.get(change.textDocument?.uri);
      const target = [...this.items.values()].find(
        (d) => d.session.id === session.id && this.diskUri(d) === change.textDocument?.uri,
      );
      if (version === undefined || !target || target.version !== version)
        throw new Error('A file changed while preparing this rename. Try again.');
      return { ...change, textDocument: { ...change.textDocument, version } };
    });
    return { documentChanges: stamped };
  }
}
export const documents = new Documents();
export { monaco };
