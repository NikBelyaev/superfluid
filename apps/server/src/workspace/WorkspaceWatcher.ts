import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Session, AppEvent } from '@superfluid/contracts';
import type { LanguageServers } from '../python/LanguageServers';

export class WorkspaceWatcher {
  private watchers = new Map<
    string,
    { watchers: FSWatcher[]; gitDirs: Set<string>; timer?: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private lsp: LanguageServers,
    private emit: (event: AppEvent) => void,
  ) {}
  observe(s: Session) {
    if (this.watchers.has(s.id)) return;
    if (this.watchers.size >= 3) {
      const [id, old] = this.watchers.entries().next().value!;
      for (const watcher of old.watchers) watcher.close();
      if (old.timer) clearTimeout(old.timer);
      this.watchers.delete(id);
    }
    try {
      const watcher = watch(s.path, { recursive: true }, (event, path) => {
        if (path && /(?:^|\/)(?:node_modules|\.venv|__pycache__|\.ruff_cache)(?:\/|$)/.test(path))
          return;
        if (path) this.lsp.changed(s.id, path, event);
        this.changed(s.id);
      });
      watcher.on('error', () => {
        for (const watcher of this.watchers.get(s.id)?.watchers ?? []) watcher.close();
        this.watchers.delete(s.id);
      });
      this.watchers.set(s.id, { watchers: [watcher], gitDirs: new Set() });
    } catch {}
  }
  private changed(sessionId: string) {
    const item = this.watchers.get(sessionId);
    if (!item || item.timer) return;
    item.timer = setTimeout(() => {
      item.timer = undefined;
      this.emit({ type: 'files.changed', sessionId });
    }, 200);
  }
  async observeGit(s: Session, gitDir: string) {
    if (!gitDir) return;
    this.observe(s);
    const item = this.watchers.get(s.id);
    if (!item || item.gitDirs.has(gitDir)) return;
    item.gitDirs.add(gitDir);
    const common = await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '');
    if (this.watchers.get(s.id) !== item) return;
    for (const directory of new Set([
      gitDir,
      ...(common ? [resolve(gitDir, common.trim())] : []),
    ])) {
      if (directory.startsWith(resolve(s.path) + sep)) continue;
      try {
        const watcher = watch(directory, { recursive: true }, (_event, path) => {
          if (!path || /^(?:index|HEAD|config|packed-refs|refs(?:\/.*)?)$/.test(path))
            this.changed(s.id);
        });
        watcher.on('error', () => watcher.close());
        item.watchers.push(watcher);
      } catch {}
    }
  }
  close() {
    for (const item of this.watchers.values()) {
      for (const watcher of item.watchers) watcher.close();
      if (item.timer) clearTimeout(item.timer);
    }
  }
}
