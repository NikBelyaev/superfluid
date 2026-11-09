import type { Input, Results } from '@superfluid/contracts';
import { desktop } from './desktop';
import { assertPythonGeneration, pythonGeneration, pythonReady } from '~/state/python';
import type { Doc } from '~/state/editor/Documents';
import type { CancellationToken } from 'monaco-editor';

const synchronized = new WeakMap<
  Doc,
  { version: number; generation: number; complete: boolean; pending: Promise<void> }
>();

export function forgetPythonDocument(doc: Doc) {
  synchronized.delete(doc);
}

export async function syncPythonDocument(doc: Doc) {
  if (doc.readOnly || doc.model.isDisposed()) return;
  const version = doc.version;
  const generation = pythonGeneration(doc.session.id);
  const previous = synchronized.get(doc);
  if (
    previous?.version === version &&
    previous.generation === generation &&
    (!previous.complete || pythonReady(doc.session.id))
  )
    return previous.pending;
  const entry = { version, generation, complete: false, pending: Promise.resolve() };
  entry.pending = desktop
    .call('lsp.open', {
      sessionId: doc.session.id,
      path: doc.path,
      text: doc.model.getValue(undefined, true),
      version,
    })
    .then((result) => {
      entry.generation = result.generation;
      entry.complete = true;
    })
    .catch((error) => {
      if (synchronized.get(doc) === entry) synchronized.delete(doc);
      throw error;
    });
  synchronized.set(doc, entry);
  return entry.pending;
}

export async function callPython<
  M extends 'lsp.request' | 'python.hover' | 'python.source' | 'python.symbols',
>(
  method: M,
  input: Input<M>,
  token?: CancellationToken | AbortSignal,
): Promise<Results[M]['value']> {
  const cancelled = () =>
    token && ('aborted' in token ? token.aborted : token.isCancellationRequested);
  if (cancelled()) throw new Error('Python request cancelled.');
  const requestId = token ? crypto.randomUUID() : undefined;
  const pending = desktop.call(method, { ...input, requestId });
  const cancel = () => {
    void desktop
      .call('lsp.cancel', { sessionId: input.sessionId, requestId: requestId! })
      .catch(() => {});
  };
  const signal = token && 'aborted' in token ? token : undefined;
  const subscription =
    token && 'onCancellationRequested' in token ? token.onCancellationRequested(cancel) : undefined;
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await pending;
    if (cancelled()) throw new Error('Python request cancelled.');
    assertPythonGeneration(input.sessionId, result.generation);
    return result.value;
  } finally {
    subscription?.dispose();
    signal?.removeEventListener('abort', cancel);
  }
}
