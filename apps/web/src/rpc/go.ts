import type { Input, Results } from '@superfluid/contracts';
import type { CancellationToken } from 'monaco-editor';
import type { Doc } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import { desktop } from './desktop';

type Sync = {
  doc: Doc;
  version: number;
  generation?: number;
  pending: Promise<number | undefined>;
};
const operations = new Map<string, Sync>();

export function syncGoDocument(doc: Doc, force = false) {
  if (doc.closed || doc.readOnly || doc.model.isDisposed()) return Promise.resolve(undefined);
  const previous = operations.get(doc.key);
  const status = useApp.getState().goLanguage[doc.session.id];
  if (
    !force &&
    previous?.doc === doc &&
    previous.version === doc.version &&
    (previous.generation === undefined ||
      (status?.phase === 'ready' && status.generation === previous.generation))
  )
    return previous.pending;
  const version = doc.version;
  const entry: Sync = {
    doc,
    version,
    pending: Promise.resolve(previous?.pending)
      .catch(() => undefined)
      .then(async () => {
        if (doc.closed || doc.model.isDisposed() || doc.version !== version) return;
        const generation = await desktop.call('go.sync', {
          sessionId: doc.session.id,
          path: doc.path,
          version,
          text: doc.model.getValue(undefined, true),
        });
        entry.generation = generation;
        return generation;
      })
      .finally(() => {
        if (entry.generation === undefined && operations.get(doc.key) === entry)
          operations.delete(doc.key);
      }),
  };
  operations.set(doc.key, entry);
  return entry.pending;
}

export function closeGoDocument(doc: Doc) {
  const previous = operations.get(doc.key);
  if (previous && previous.doc !== doc) return Promise.resolve();
  const entry: Sync = {
    doc,
    version: -1,
    pending: Promise.resolve(previous?.pending)
      .catch(() => undefined)
      .then(async () => {
        await desktop.call('go.close', { sessionId: doc.session.id, path: doc.path });
        return undefined;
      })
      .finally(() => {
        if (operations.get(doc.key) === entry) operations.delete(doc.key);
      }),
  };
  operations.set(doc.key, entry);
  return entry.pending;
}

export async function requestGo<M extends 'go.completion' | 'go.hover' | 'go.definition'>(
  method: M,
  doc: Doc,
  position: Input<M>['position'],
  token: CancellationToken,
): Promise<Results[M] | undefined> {
  const version = doc.version;
  const current = () =>
    !doc.closed &&
    !doc.model.isDisposed() &&
    doc.version === version &&
    !token.isCancellationRequested &&
    useApp.getState().sessionId === doc.session.id;
  if (!current()) return;
  const generation = await syncGoDocument(doc);
  if (generation === undefined || !current()) return;
  const sessionId = doc.session.id;
  const requestId = crypto.randomUUID();
  const response = desktop.call(method, {
    sessionId,
    path: doc.path,
    position,
    requestId,
    generation,
  } as Input<M>);
  const subscription = token.onCancellationRequested(() => {
    void desktop.call('go.cancel', { sessionId, requestId }).catch(() => {});
  });
  try {
    const result = await response;
    const status = useApp.getState().goLanguage[sessionId];
    if (current() && status?.phase === 'ready' && status.generation === generation) return result;
  } finally {
    subscription.dispose();
  }
}
