import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { documents, subscribe, getRevision } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import DiffWorker from './diff.worker?worker';
import { workingFileText } from './workingFileText';

export function useFileDiff(session: Session, path?: string, refresh = 0) {
  const statuses = useApp((a) => a.repositoryGit[session.id]);
  const repositories = useApp((a) => a.repositories[session.id]);
  useSyncExternalStore(subscribe, getRevision);
  const doc = path ? documents.items.get(documents.key(session.id, path)) : undefined;
  const key = `${session.id}:${path}`;
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const comparedVersion = useRef<number | undefined>(undefined);
  const [source, setSource] = useState<{
    key: string;
    base: string;
    text: string;
    deleted: boolean;
  }>();
  const [result, setResult] = useState<{
    key: string;
    files?: FileDiffMetadata[];
    error?: string;
    unsupported?: boolean;
    version?: number;
  }>();
  useEffect(() => {
    if (!path || path.startsWith('file://') || path.endsWith('/')) return;
    const instance = new DiffWorker();
    worker.current = instance;
    instance.onmessage = (
      event: MessageEvent<{ id: number; files?: FileDiffMetadata[]; error?: string }>,
    ) => {
      if (event.data.id === generation.current)
        setResult({
          key,
          files: event.data.files,
          error: event.data.error,
          version: comparedVersion.current,
        });
    };
    instance.onerror = () => {
      setResult({ key, error: 'Could not compare this file with the Git index.' });
    };
    return () => {
      generation.current++;
      worker.current = null;
      instance.terminate();
    };
  }, [key, path]);
  useEffect(() => {
    if (!path || source?.key !== key) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const id = ++generation.current;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (doc?.model.isDisposed()) return;
        comparedVersion.current = doc?.model.getVersionId();
        worker.current?.postMessage({
          id,
          oldFile: { name: path, contents: source.base },
          newFile: {
            name: path,
            contents: workingFileText(
              source.text,
              source.deleted,
              doc && {
                text: doc.model.getValue(undefined, true),
                dirty: doc.dirty,
              },
            ),
          },
        });
      }, 100);
    };
    const changed = doc?.model.onDidChangeContent(update);
    update();
    return () => {
      generation.current++;
      clearTimeout(timer);
      changed?.dispose();
    };
  }, [key, path, doc, source]);
  useEffect(() => {
    if (!path || path.startsWith('file://') || path.endsWith('/')) return;
    let cancelled = false;
    const repository = repositories
      ?.filter((r) => !r.path || path.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const relative = repository?.path ? path.slice(repository.path.length + 1) : path;
    const file = repository && statuses?.[repository.id]?.files.find((f) => f.path === relative);
    void desktop
      .call('git.index', { sessionId: session.id, path })
      .then(async (base) => {
        if (cancelled) return;
        if (base === null) {
          setSource(undefined);
          setResult({ key, unsupported: true });
          return;
        }
        const deleted = file?.worktree === 'D' || file?.index === 'D';
        const text =
          doc && !deleted
            ? ''
            : await desktop
                .call('files.read', { sessionId: session.id, path, diskOnly: deleted })
                .then(
                  (data) => data.text,
                  (error: unknown) => {
                    if (deleted && error instanceof Error && error.message.includes('ENOENT'))
                      return '';
                    throw error;
                  },
                );
        if (!cancelled)
          setSource((current) =>
            current?.key === key &&
            current.base === base &&
            current.text === text &&
            current.deleted === deleted
              ? current
              : { key, base, text, deleted },
          );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSource(undefined);
          setResult({ key, error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, path, doc, statuses, repositories, refresh]);
  return result?.key === key ? result : undefined;
}
