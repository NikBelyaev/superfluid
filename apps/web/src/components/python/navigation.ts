import { monaco } from '~/state/editor/Documents';
import { useApp, type Location } from '~/state/workspaceStore';
import { surfaceKey, tabGroup } from '~/state/workspaceView';
import { surfacePaths } from '~/state/fileChains';
import type { Session } from '@superfluid/contracts';

export async function navigate(
  session: Session,
  uri: monaco.Uri,
  line: number,
  column: number,
  origin?: Location,
) {
  const app = useApp.getState(),
    view = app.views[session.id];
  if (app.sessionId !== session.id) return;
  const group = origin?.group ?? 'main';
  const source = tabGroup(view, group).active;
  if (origin && (source?.kind !== 'file' || source.path !== origin.path)) return;
  let path: string;
  if (uri.scheme === 'superfluid-file') {
    if (uri.authority !== session.id)
      throw new Error('This definition belongs to another worktree.');
    path = uri.path.slice(1);
  } else {
    const root = session.path.replace(/\/$/, '') + '/';
    if (uri.scheme !== 'file') throw new Error('This definition is not a source file.');
    if (uri.fsPath.startsWith(root)) path = uri.fsPath.slice(root.length);
    else {
      path = uri.toString();
      if (origin) {
        const sources = {
          ...view.definitionSources,
          [path]: {
            path: origin.path,
            position: { line: origin.line - 1, character: origin.column - 1 },
            target: { uri: path, position: { line: line - 1, character: column - 1 } },
          },
        };
        const retained = new Set([
          ...[...view.tabs, ...view.rightTabs, ...view.bottomTabs].flatMap(surfacePaths),
          ...view.history.map((location) => location.path),
          path,
        ]);
        app.setView(
          {
            definitionSources: Object.fromEntries(
              Object.entries(sources).filter(([key]) => retained.has(key)),
            ),
          },
          session.id,
        );
      } else if (!view.definitionSources?.[path])
        throw new Error('Open this definition from a Python symbol first.');
    }
  }
  await app.openFile(
    path,
    line,
    column,
    true,
    group,
    origin && source?.kind === 'file' ? { tabKey: surfaceKey(source), origin } : undefined,
  );
}
