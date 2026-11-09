import { useEffect, useState } from 'react';
import { ArrowUpRight, FileCode2 } from 'lucide-react';
import type { SearchMatch, SearchResults, Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { Highlight } from './Highlight';

export function SearchPreview({
  hit,
  session,
  query,
  open,
}: {
  hit?: SearchMatch;
  session: Session;
  query: string;
  open: () => void;
}) {
  const [preview, setPreview] = useState<SearchResults['search.preview']>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hit) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void desktop
        .call('search.preview', { sessionId: session.id, path: hit.path, line: hit.line })
        .then((value) => {
          if (!cancelled) setPreview(value);
        })
        .catch((error) => {
          if (!cancelled) setError(error.message);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hit, session.id]);
  return (
    <aside
      className="flex min-h-0 min-w-0 flex-col border-0 border-l border-solid border-border p-5 @max-[1050px]/search:hidden"
      aria-label="Result preview"
    >
      {hit ? (
        <>
          <div className="mb-5 flex items-start gap-2.5">
            <FileCode2 className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
            <div className="min-w-0">
              <strong className="block text-sm leading-5 font-medium [overflow-wrap:anywhere]">
                {hit.path.split('/').at(-1)}
              </strong>
              <span className="block text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                {hit.path}
              </span>
            </div>
          </div>
          <div
            className="mx-[-20px] mt-0 mb-[18px] min-h-0 flex-1 overflow-auto py-1"
            aria-busy={!preview && !error}
          >
            {error ? (
              <p className="p-3 text-sm leading-[21px] text-muted-foreground [overflow-wrap:anywhere]">
                {error}
              </p>
            ) : preview ? (
              <pre className="m-0 w-max min-w-full font-mono text-xs leading-[23px]">
                {preview.text.split('\n').map((line, i) => (
                  <div
                    key={i}
                    className={`flex pr-4 ${preview.startLine + i === hit.line ? 'bg-accent' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className="w-[42px] shrink-0 pr-3 text-right text-muted-foreground tabular-nums select-none"
                    >
                      {preview.startLine + i}
                    </span>
                    <code className="whitespace-pre [font:inherit]">
                      <Highlight text={line || ' '} query={query} />
                    </code>
                  </div>
                ))}
              </pre>
            ) : (
              <p className="p-3 text-sm leading-[21px] text-muted-foreground [overflow-wrap:anywhere]">
                Loading preview…
              </p>
            )}
          </div>
          <button
            className="inline-flex h-8 min-h-[34px] w-full items-center justify-center gap-2 rounded-[var(--control-radius)] border border-solid border-border bg-card px-3 text-sm leading-5 font-medium whitespace-nowrap shadow-none hover:border-input hover:bg-sidebar"
            onClick={open}
          >
            Open file
            <ArrowUpRight size={14} />
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-foreground/7 px-1 font-sans text-xs leading-5 font-medium whitespace-nowrap text-(--control-muted-foreground)">
              ↵
            </kbd>
          </button>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-sm leading-5 text-muted-foreground">
          <FileCode2 size={24} />
          <span>Select a result to preview</span>
        </div>
      )}
    </aside>
  );
}
