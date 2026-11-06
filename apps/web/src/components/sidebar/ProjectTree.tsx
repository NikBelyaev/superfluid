import { desktop } from '~/rpc/desktop';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { FileEntry, Session } from '@superfluid/contracts';
import { useApp, showSurface } from '~/state/workspaceStore';

const cache = new Map<string, Record<string, FileEntry[]>>();

export default function ProjectTree({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]),
    status = useApp((a) => a.git[session.id]);
  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>(cache.get(session.id) ?? {}),
    [error, setError] = useState(''),
    [scroll, setScroll] = useState(0),
    [focused, setFocused] = useState<string | null>(null),
    [height, setHeight] = useState(500);
  const host = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  const load = async (path: string) => {
    const gen = generation.current;
    try {
      const entries = await desktop.call('files.list', { sessionId: session.id, path });
      if (gen !== generation.current) return;
      setDirs((old) => {
        const next = { ...old, [path]: entries };
        cache.delete(session.id);
        cache.set(session.id, next);
        while (cache.size > 3) cache.delete(cache.keys().next().value!);
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    generation.current++;
    setDirs(cache.get(session.id) ?? {});
    setError('');
    void load('');
    const obs = new ResizeObserver((es) => setHeight(es[0].contentRect.height));
    if (host.current) obs.observe(host.current);
    return () => {
      generation.current++;
      obs.disconnect();
    };
  }, [session.id]);
  useEffect(
    () =>
      desktop.onEvent((e) => {
        if (e.type === 'files.changed' && e.sessionId === session.id) {
          void (async () => {
            for (const path of Object.keys(cache.get(session.id) ?? { '': [] })) await load(path);
          })();
        }
      }),
    [session.id],
  );
  useEffect(() => {
    void (async () => {
      for (const path of view.expanded) if (!dirs[path]) await load(path);
    })();
  }, [view.expanded, session.id]);
  const toggle = (path: string) =>
    useApp.getState().setView({
      expanded: view.expanded.includes(path)
        ? view.expanded.filter((x) => x !== path)
        : [...view.expanded, path],
    });
  const rows: { entry: FileEntry; depth: number }[] = [];
  if (view.changes) {
    for (const f of status?.files ?? [])
      rows.push({
        entry: { name: f.path.split('/').at(-1)!, path: f.path, directory: false, symlink: false },
        depth: 0,
      });
  } else {
    const flatten = (path: string, depth: number) => {
      for (const entry of dirs[path] ?? []) {
        rows.push({ entry, depth });
        if (entry.directory && view.expanded.includes(entry.path)) flatten(entry.path, depth + 1);
      }
    };
    flatten('', 0);
  }
  const start = Math.max(0, Math.floor(scroll / 28) - 10),
    end = Math.min(rows.length, start + Math.ceil(height / 28) + 20);
  const selected =
    view.changes && view.surface?.kind === 'diff'
      ? (view.surface.path ?? status?.files[0]?.path)
      : view.active;
  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <button
          className="text-button"
          onClick={() => useApp.getState().setView({ changes: !view.changes })}
        >
          {view.changes ? 'Changes' : 'Project'}
          <ChevronDown size={12} />
        </button>
        <div className="spacer" />
        <button
          className="icon-button"
          title="New file"
          onClick={() =>
            useApp.setState({ modal: { kind: 'new-file', directory: false, parent: '' } })
          }
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-button"
          title="New folder"
          onClick={() =>
            useApp.setState({ modal: { kind: 'new-file', directory: true, parent: '' } })
          }
        >
          <FolderPlus size={14} />
        </button>
        <button className="icon-button" title="Refresh project tree" onClick={() => void load('')}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="tree-root">
        <ChevronDown size={13} />
        <FolderOpen size={15} />
        <span>{session.path.split('/').at(-1)}</span>
      </div>
      <div
        ref={host}
        className="tree-scroll"
        role="tree"
        tabIndex={0}
        onFocus={(e) => {
          if (e.target === e.currentTarget)
            (
              e.currentTarget.querySelector<HTMLElement>('[aria-selected="true"]') ??
              e.currentTarget.querySelector<HTMLElement>('.tree-row')
            )?.focus();
        }}
        aria-label={view.changes ? 'Changed files' : 'Project files'}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        {error && <p className="inline-error">{error}</p>}
        <div style={{ height: rows.length * 28, position: 'relative' }}>
          {rows.slice(start, end).map(({ entry, depth }, index) => {
            const expanded = view.expanded.includes(entry.path),
              change = status?.files.find((f) => f.path === entry.path);
            return (
              <div
                key={entry.path}
                data-path={entry.path}
                className={`tree-row ${selected === entry.path ? 'selected' : ''}`}
                style={{ top: (start + index) * 28, paddingLeft: 12 + depth * 14 }}
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={entry.directory ? expanded : undefined}
                aria-selected={selected === entry.path}
                tabIndex={
                  (
                    focused
                      ? focused === entry.path
                      : selected
                        ? selected === entry.path
                        : index === 0
                  )
                    ? 0
                    : -1
                }
                onFocus={() => setFocused(entry.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    entry.directory
                      ? toggle(entry.path)
                      : view.changes
                        ? showSurface({ kind: 'diff', path: entry.path })
                        : void useApp.getState().openFile(entry.path);
                  } else if (e.key === 'ArrowRight' && entry.directory && !expanded)
                    toggle(entry.path);
                  else if (e.key === 'ArrowLeft' && entry.directory && expanded) toggle(entry.path);
                  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const next = Math.max(
                      0,
                      Math.min(rows.length - 1, start + index + (e.key === 'ArrowDown' ? 1 : -1)),
                    );
                    host.current!.scrollTop = Math.max(0, next * 28 - height / 2);
                    const target = rows[next].entry.path;
                    setFocused(target);
                    requestAnimationFrame(() => {
                      const row = [
                        ...host.current!.querySelectorAll<HTMLElement>('[data-path]'),
                      ].find((node) => node.dataset.path === target);
                      row?.focus();
                    });
                  }
                }}
                onClick={() =>
                  entry.directory
                    ? toggle(entry.path)
                    : view.changes
                      ? showSurface({ kind: 'diff', path: entry.path })
                      : void useApp.getState().openFile(entry.path)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  useApp.setState({ modal: { kind: 'rename', path: entry.path } });
                }}
              >
                {entry.directory ? (
                  expanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )
                ) : (
                  <span className="tree-indent" />
                )}
                {entry.directory ? (
                  <Folder size={14} />
                ) : entry.name.endsWith('.py') ? (
                  <FileCode2 size={14} className="python-icon" />
                ) : (
                  <FileText size={13} />
                )}
                <span className="file-label">{view.changes ? entry.path : entry.name}</span>
                {change && (
                  <span className={`git-letter ${change.index === '?' ? 'new' : ''}`}>
                    {change.index === '?'
                      ? 'U'
                      : change.worktree !== '.'
                        ? change.worktree
                        : change.index}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {!rows.length && !error && (
          <div className="tree-empty">
            {view.changes ? 'No local changes.' : 'This folder is empty.'}
          </div>
        )}
      </div>
    </aside>
  );
}
