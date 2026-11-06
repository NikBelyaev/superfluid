import { lstat, open, rename, unlink, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command } from '../process/ProcessRunner';
import { Gate } from '../utils/Gate';
import type { DocumentData, FileEntry, Session, SearchHit } from '@superfluid/contracts';
import { logicalPath, within } from './paths';
import { digest } from '../utils/digest';

const excluded = new Set([
  '.git',
  '.venv',
  'node_modules',
  '__pycache__',
  '.mypy_cache',
  '.ruff_cache',
  '.pytest_cache',
]);

export class FileService {
  private writes = new Gate(1, 16);
  private io = new Gate(2, 8);
  private searchGate = new Gate(2, 8);
  async list(s: Session, path: string): Promise<FileEntry[]> {
    const directory = await within(s.path, path);
    const entries: FileEntry[] = [];
    const dir = await import('node:fs/promises').then((fs) => fs.opendir(directory));
    for await (const entry of dir) {
      if (excluded.has(entry.name) || entry.name === '.DS_Store') continue;
      if (entries.length >= 10000)
        throw new Error(
          'This folder has more than 10,000 entries. Use file search to narrow the selection.',
        );
      entries.push({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        directory: entry.isDirectory(),
        symlink: entry.isSymbolicLink(),
      });
    }
    return entries.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
  }
  async read(s: Session, path: string): Promise<DocumentData> {
    return this.io.run(async () => {
      const file = await within(s.path, path);
      const handle = await open(file, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 2 * 1024 * 1024)
          throw new Error(
            'This file is too large for the editor (2 MiB limit). Open it in another application.',
          );
        const bytes = await handle.readFile();
        if (bytes.includes(0))
          throw new Error('This is a binary file. Open it in another application.');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        return { path, text, hash: digest(bytes), version: 0 };
      } finally {
        await handle.close();
      }
    });
  }
  async save(s: Session, path: string, text: string, hash: string) {
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      throw new Error(
        'This document exceeds the 2 MiB editor limit. Export or split it before saving.',
      );
    return this.writes.run(async () => {
      const lexical = resolve(s.path, path);
      const file = await within(s.path, path);
      const info = await lstat(lexical);
      if (info.isSymbolicLink() || info.nlink > 1)
        throw new Error(
          'Saving through symbolic or hard links requires opening the original file.',
        );
      const current = await this.read(s, path);
      if (current.hash !== hash)
        throw new Error(
          'The file changed on disk. Compare or reload it before saving. Your edits are kept.',
        );
      const temp = join(dirname(file), `.superfluid-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temp, 'wx', info.mode);
        await handle.writeFile(text, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        const latest = await this.read(s, path);
        if (latest.hash !== hash)
          throw new Error('The file changed while saving. Your edits are kept.');
        await rename(temp, file);
        const directory = await open(dirname(file), 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        return { hash: digest(text) };
      } finally {
        if (handle) await handle.close();
        await unlink(temp).catch(() => {});
      }
    });
  }
  async create(s: Session, path: string, directory: boolean) {
    return this.writes.run(async () => {
      const file = await within(s.path, path, true);
      if (!path) throw new Error('Enter a name.');
      if (directory) await mkdir(file);
      else {
        const h = await open(file, 'wx');
        await h.close();
      }
    });
  }
  async rename(s: Session, path: string, target: string) {
    return this.writes.run(async () => {
      await within(s.path, path);
      const source = logicalPath(s.path, path),
        destination = await within(s.path, target, true);
      if (!path || !target) throw new Error('The worktree root cannot be renamed here.');
      try {
        await access(destination);
        throw new Error('A file with that name already exists.');
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      await rename(source, destination);
    });
  }
  async search(
    s: Session,
    query: string,
    content: boolean,
  ): Promise<{ hits: SearchHit[]; truncated: boolean }> {
    return this.searchGate.run(async () => {
      if (!query.trim()) return { hits: [], truncated: false };
      const args = content
        ? ['--json', '--max-count', '10', '--fixed-strings', '--', query, '.']
        : ['--files', '--hidden', '-0', '-g', '!.git', '-g', '!.venv', '-g', '!node_modules'];
      const result = await command('rg', args, {
        cwd: s.path,
        timeout: 10000,
        accept: [1],
        limit: 4 * 1024 * 1024,
      });
      if (!content) {
        const matches = result
          .split('\0')
          .filter((p) => p && p.toLowerCase().includes(query.toLowerCase()));
        return {
          hits: matches.slice(0, 500).map((path) => ({ path })),
          truncated: matches.length > 500,
        };
      }
      const hits: SearchHit[] = [];
      for (const line of result.split('\n')) {
        if (!line) continue;
        const entry = JSON.parse(line);
        if (entry.type === 'match')
          hits.push({
            path: entry.data.path.text.replace(/^\.\//, ''),
            line: entry.data.line_number,
            text: entry.data.lines.text.trimEnd(),
          });
        if (hits.length >= 500) break;
      }
      return { hits, truncated: hits.length >= 500 };
    });
  }
}
