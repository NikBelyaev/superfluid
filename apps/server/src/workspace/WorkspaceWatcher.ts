import { watch, type FSWatcher } from 'node:fs';
import type { Session, AppEvent } from '@superfluid/contracts';
import type { LanguageServers } from '../python/LanguageServers';

export class WorkspaceWatcher {
  private watchers = new Map<
    string,
    { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private lsp: LanguageServers,
    private emit: (event: AppEvent) => void,
  ) {}
  observe(s: Session) {
    if (this.watchers.has(s.id)) return;
    if (this.watchers.size >= 3) {
      const [id, old] = this.watchers.entries().next().value!;
      old.watcher.close();
      if (old.timer) clearTimeout(old.timer);
      this.watchers.delete(id);
    }
    try {
      const item: { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> } = {
        watcher: watch(s.path, { recursive: true }, (event, path) => {
          if (path && /(?:^|\/)(?:node_modules|\.venv|__pycache__|\.ruff_cache)(?:\/|$)/.test(path))
            return;
          if (path) this.lsp.changed(s.id, path, event);
          if (item.timer) return;
          item.timer = setTimeout(() => {
            item.timer = undefined;
            this.emit({ type: 'files.changed', sessionId: s.id });
          }, 200);
        }),
      };
      item.watcher.on('error', () => {
        item.watcher.close();
        this.watchers.delete(s.id);
      });
      this.watchers.set(s.id, item);
    } catch {}
  }
  close() {
    for (const item of this.watchers.values()) {
      item.watcher.close();
      if (item.timer) clearTimeout(item.timer);
    }
  }
}
