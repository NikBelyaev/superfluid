import { useEffect, useState } from 'react';
import { CircleDot } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  PullRequestRef,
  PullRequestComment,
  PullRequestActivity,
  Page,
} from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';

export function RequestMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) void desktop.external(href).catch(useApp.getState().fail);
            }}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}

export function PullRequestDiscussion({
  sessionId,
  repositoryId,
  request,
  timeline = false,
  revision = 0,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequestRef;
  timeline?: boolean;
  revision?: number;
}) {
  const [page, setPage] = useState(1),
    [token, setToken] = useState(0),
    [error, setError] = useState('');
  const [comments, setComments] = useState<Page<PullRequestComment> | null>(null);
  const [activity, setActivity] = useState<Page<PullRequestActivity> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setComments(null);
    setActivity(null);
    const work = timeline
      ? desktop
          .call('pr.timeline', { sessionId, repositoryId, ref: request, page })
          .then((data) => {
            if (!cancelled) setActivity(data);
          })
      : desktop
          .call('pr.comments', { sessionId, repositoryId, ref: request, page })
          .then((data) => {
            if (!cancelled) setComments(data);
          });
    void work.catch((error: Error) => {
      if (!cancelled) setError(error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, repositoryId, request, timeline, page, token, revision]);
  const result = timeline ? activity : comments;
  return (
    <div className={timeline ? 'pr-timeline-events' : 'pr-conversation'}>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setToken(token + 1)}>
            Try again
          </button>
        </p>
      ) : !result ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          {comments?.items.map((comment) => (
            <article className="pr-comment" key={comment.id}>
              <header className="pr-comment-identity">
                <strong>{comment.author?.login ?? 'User'}</strong>
                <time
                  dateTime={comment.createdAt}
                  title={new Date(comment.createdAt).toLocaleString()}
                >
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </header>
              <div className="markdown">
                <RequestMarkdown text={comment.body} />
              </div>
            </article>
          ))}
          {activity?.items.map((item) => (
            <article className="timeline-item" key={item.id}>
              <span className="timeline-marker" aria-hidden>
                <CircleDot size={16} />
              </span>
              <strong>{item.title}</strong>
              <small>{item.date ? new Date(item.date).toLocaleString() : ''}</small>
              <div className="markdown">
                <RequestMarkdown text={item.body} />
              </div>
            </article>
          ))}
          {!result.items.length && <p>No {timeline ? 'activity' : 'comments'} on this page.</p>}
        </>
      )}
      {(page > 1 || result?.hasMore) && (
        <div className="pr-list-tools">
          <button
            className="button"
            disabled={page === 1 || !result}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button className="button" disabled={!result?.hasMore} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
