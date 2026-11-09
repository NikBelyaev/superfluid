import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { mapViewFiles } from '~/state/workspaceView';

async function relocateFile(sessionId: string, path: string, target: string) {
  const { documents } = await import('~/state/editor/Documents');
  documents.assertClean(sessionId, path);
  await desktop.call('files.rename', { sessionId, path, target });
  documents.removePaths(sessionId, path);
  const app = useApp.getState();
  const view = app.views[sessionId];
  const mapped = (value: string) =>
    value === path || value.startsWith(path + '/') ? target + value.slice(path.length) : value;
  app.setView(
    {
      ...mapViewFiles(view, mapped),
      expanded: view.expanded.map(mapped),
      editorViews: Object.fromEntries(
        Object.entries(view.editorViews ?? {}).map(([key, value]) => [
          key.slice(0, key.indexOf(':') + 1) + mapped(key.slice(key.indexOf(':') + 1)),
          value,
        ]),
      ),
      history: view.history.map((location) => ({ ...location, path: mapped(location.path) })),
    },
    sessionId,
  );
  useApp.setState((state) => ({ revision: state.revision + 1 }));
}

export async function renameFile(sessionId: string, path: string, target: string) {
  await relocateFile(sessionId, path, target);
  await useApp.getState().refreshGit(sessionId);
}

export async function trashFile(sessionId: string, path: string) {
  if (!confirm(`Move ${path} to the Trash?`)) return false;
  const { documents } = await import('~/state/editor/Documents');
  documents.assertClean(sessionId, path);
  await desktop.trash(sessionId, path);
  documents.removePaths(sessionId, path);
  const app = useApp.getState();
  const view = app.views[sessionId];
  const matches = (value: string) => value === path || value.startsWith(path + '/');
  app.setView(
    {
      ...mapViewFiles(view, (value) => (matches(value) ? null : value)),
      expanded: view.expanded.filter((value) => !matches(value)),
      editorViews: Object.fromEntries(
        Object.entries(view.editorViews ?? {}).filter(
          ([key]) => !matches(key.slice(key.indexOf(':') + 1)),
        ),
      ),
    },
    sessionId,
  );
  useApp.setState((state) => ({ revision: state.revision + 1 }));
  await useApp.getState().refreshGit(sessionId);
  return true;
}

export async function moveFiles(sessionId: string, paths: string[], directory: string) {
  const roots: string[] = [];
  for (const path of [...new Set(paths)].sort())
    if (!roots.length || !path.startsWith(roots.at(-1)! + '/')) roots.push(path);
  const { documents } = await import('~/state/editor/Documents');
  for (const path of roots) documents.assertClean(sessionId, path);
  const moved: string[] = [];
  try {
    for (const path of roots) {
      const target = [directory, path.split('/').at(-1)].filter(Boolean).join('/');
      if (target !== path) await relocateFile(sessionId, path, target);
      moved.push(target);
    }
  } finally {
    await useApp.getState().refreshGit(sessionId);
  }
  return moved;
}
