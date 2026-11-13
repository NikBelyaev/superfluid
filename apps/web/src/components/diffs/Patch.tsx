import { useEffect, useState, type ReactNode } from 'react';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';
import type { FileDiffMetadata } from '@pierre/diffs';
import DiffWorker from '~/components/diffs/diff.worker?worker';
import { diffOptions } from './diffOptions';
import { resolveAppearance, useAppearance, useSystemDark } from '~/state/appearance';

export function Patch({
  patch,
  split = false,
  fallback,
  files,
}: {
  patch?: string;
  split?: boolean;
  fallback?: ReactNode;
  files?: FileDiffMetadata[];
}) {
  const { scheme } = resolveAppearance(useAppearance(), useSystemDark());
  const [parsed, setFiles] = useState<FileDiffMetadata[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (files) return;
    const worker = new DiffWorker();
    setLoading(true);
    setError('');
    worker.onmessage = (event) => {
      if (event.data.error) setError(event.data.error);
      else setFiles(event.data.files);
      setLoading(false);
    };
    worker.onerror = () => {
      setError('Could not parse this diff.');
      setLoading(false);
    };
    worker.postMessage(patch);
    return () => worker.terminate();
  }, [patch, files]);
  if (!files && error) return <div className="surface-empty error-text">{error}</div>;
  if (!files && loading) return fallback ?? <div className="surface-empty">Preparing diff…</div>;
  return (
    <Virtualizer className="diff-scroll">
      <div className="diff-files">
        {(files ?? parsed).map((file, index) => (
          <FileDiff
            key={index}
            fileDiff={file}
            options={{ ...diffOptions, themeType: scheme, diffStyle: split ? 'split' : 'unified' }}
          />
        ))}
      </div>
    </Virtualizer>
  );
}
