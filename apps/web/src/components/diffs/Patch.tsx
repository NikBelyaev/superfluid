import { useEffect, useState } from 'react';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';
import type { parsePatchFiles } from '@pierre/diffs';
import DiffWorker from '~/components/diffs/diff.worker?worker';
import { diffOptions } from './diffOptions';
import { resolveAppearance, useAppearance, useSystemDark } from '~/state/appearance';

export function Patch({ patch, split = false }: { patch: string; split?: boolean }) {
  const { scheme } = resolveAppearance(useAppearance(), useSystemDark());
  const [files, setFiles] = useState<ReturnType<typeof parsePatchFiles>[number]['files']>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
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
  }, [patch]);
  if (error) return <div className="surface-empty error-text">{error}</div>;
  if (loading) return <div className="surface-empty">Preparing diff…</div>;
  return (
    <Virtualizer className="diff-scroll">
      <div className="diff-files">
        {files.map((file, index) => (
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
