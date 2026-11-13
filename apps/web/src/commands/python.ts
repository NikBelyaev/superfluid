import { desktop } from '~/rpc/desktop';
import { documents, type Doc } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import { activeFile } from '~/state/workspaceView';

export async function organizeImports(doc?: Doc | null) {
  if (!doc) {
    const { sessionId, views } = useApp.getState();
    if (!sessionId) return;
    const path = views[sessionId] && activeFile(views[sessionId]);
    doc =
      documents.focused?.session.id === sessionId
        ? documents.focused
        : path
          ? documents.items.get(documents.key(sessionId, path))
          : undefined;
  }
  if (!doc || doc.readOnly || doc.model.isDisposed() || doc.model.getLanguageId() !== 'python')
    return;
  const { model, version } = doc;
  const text = await desktop.call('python.organizeImports', {
    sessionId: doc.session.id,
    path: doc.path,
    text: model.getValue(),
  });
  if (model.isDisposed() || doc.closed || doc.version !== version)
    throw new Error('The document changed while optimizing imports. Try again.');
  if (text === model.getValue()) return;
  model.pushStackElement();
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  model.pushStackElement();
}
