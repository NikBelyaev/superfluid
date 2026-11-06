import { monaco } from '~/state/editor/Documents';
import { useApp, resolveLocationSymbol, type Location } from '~/state/workspaceStore';
import type { Session } from '@superfluid/contracts';

export async function navigate(
  session: Session,
  uri: monaco.Uri,
  line: number,
  column: number,
  origin?: Location,
) {
  let path: string;
  if (uri.scheme === 'superfluid-file') {
    if (uri.authority !== session.id)
      throw new Error('This definition belongs to another worktree.');
    path = uri.path.slice(1);
  } else {
    const root = session.path.replace(/\/$/, '') + '/';
    if (!uri.fsPath.startsWith(root))
      throw new Error(
        'This definition is outside the current worktree. Open that source folder as a project to inspect it.',
      );
    path = uri.fsPath.slice(root.length);
  }
  const app = useApp.getState(),
    view = app.views[session.id];
  if (app.sessionId !== session.id) return;
  if (origin) {
    const history = view.history.slice(0, view.historyIndex + 1);
    if (
      !history.length ||
      history.at(-1)?.path !== origin.path ||
      history.at(-1)?.line !== origin.line
    ) {
      history.push(origin);
      void resolveLocationSymbol(session.id, origin);
    }
    app.setView({ history, historyIndex: history.length - 1 }, session.id);
  }
  await app.openFile(path, line, column, true);
}
