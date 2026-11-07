import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, Draft, Operation, Project, Session } from '@superfluid/contracts';
import { WORKSPACE_DATA_VERSION } from '@superfluid/contracts';

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, 'workspace.sqlite');
    this.db = new DatabaseSync(file);
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > WORKSPACE_DATA_VERSION) {
      this.db.close();
      throw new Error('This workspace requires a newer version of Superfluid.');
    }
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(session TEXT NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL,
        hash TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(session,path));
      PRAGMA user_version=${WORKSPACE_DATA_VERSION};`);
  }
  all<T>(table: 'projects' | 'sessions' | 'actions' | 'operations'): T[] {
    return this.db
      .prepare(`SELECT value FROM ${table}`)
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  get<T>(table: 'projects' | 'sessions' | 'actions' | 'operations', id: string): T | undefined {
    const row = this.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.value as string) : undefined;
  }
  put(
    table: 'projects' | 'sessions' | 'actions' | 'operations',
    value: Project | Session | Action | Operation,
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
      )
      .run(value.id, JSON.stringify(value));
  }
  deleteAction(id: string) {
    this.db.prepare('DELETE FROM actions WHERE id=?').run(id);
  }
  drafts(sessionId: string): Draft[] {
    return this.db
      .prepare('SELECT * FROM drafts WHERE session=?')
      .all(sessionId)
      .map((r) => ({
        sessionId,
        path: r.path as string,
        text: r.text as string,
        hash: r.hash as string,
        version: r.version as number,
        updatedAt: r.updated as number,
      }));
  }
  draft(input: Omit<Draft, 'updatedAt'>) {
    const updatedAt = Date.now();
    const total = this.db
      .prepare('SELECT coalesce(sum(length(CAST(text AS BLOB))),0) AS size FROM drafts')
      .get()!.size as number;
    const previous = this.db
      .prepare('SELECT length(CAST(text AS BLOB)) AS size FROM drafts WHERE session=? AND path=?')
      .get(input.sessionId, input.path);
    if (total - Number(previous?.size ?? 0) + Buffer.byteLength(input.text) > 128 * 1024 * 1024)
      throw new Error(
        'Recovery storage limit reached. Save or export a document before opening more files.',
      );
    this.db
      .prepare(
        `INSERT INTO drafts(session,path,text,hash,version,updated) VALUES(?,?,?,?,?,?)
      ON CONFLICT(session,path) DO UPDATE SET text=excluded.text,hash=excluded.hash,version=excluded.version,updated=excluded.updated WHERE excluded.version>=drafts.version`,
      )
      .run(input.sessionId, input.path, input.text, input.hash, input.version, updatedAt);
    const row = this.db
      .prepare('SELECT version,updated FROM drafts WHERE session=? AND path=?')
      .get(input.sessionId, input.path)!;
    return { version: Number(row.version), updatedAt: Number(row.updated) };
  }
  dropDraft(sessionId: string, path: string, version: number) {
    this.db
      .prepare('DELETE FROM drafts WHERE session=? AND path=? AND version<=?')
      .run(sessionId, path, version);
  }
  getDraft(sessionId: string, path: string): Draft | undefined {
    const r = this.db
      .prepare('SELECT * FROM drafts WHERE session=? AND path=?')
      .get(sessionId, path);
    return r
      ? {
          sessionId,
          path,
          text: r.text as string,
          hash: r.hash as string,
          version: r.version as number,
          updatedAt: r.updated as number,
        }
      : undefined;
  }
  close() {
    this.db.close();
  }
}
