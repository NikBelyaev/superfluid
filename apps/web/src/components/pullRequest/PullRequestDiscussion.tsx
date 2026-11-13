import { MarkdownText as RequestMarkdown } from '~/components/ui/MarkdownText';
import { useEffect, useState } from 'react';
import { CircleDot } from 'lucide-react';
import type {
  PullRequestRef,
  PullRequestComment,
  PullRequestActivity,
  Page,
} from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { PullRequestDiscussionSkeleton } from './PullRequestSkeleton';

export function PullRequestDiscussion({
  sessionId,
  repositoryId,
  request,
  timeline = false,
  revision = 0,
  onSelectCommit,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequestRef;
  timeline?: boolean;
  revision?: number;
  onSelectCommit?: (commit: { sha: string; title: string }) => void;
}) {
  const [page, setPage] = useState(1),
    [token, setToken] = useState(0),
    [error, setError] = useState('');
  const [comments, setComments] = useState<Page<PullRequestComment> | null>(null);
  const [activity, setActivity] = useState<Page<PullRequestActivity> | null>(null);
  const { provider, host, project, number } = request;
  useEffect(() => {
    let cancelled = false;
    setError('');
    setComments(null);
    setActivity(null);
    const work = timeline
      ? desktop
          .call('pr.timeline', {
            sessionId,
            repositoryId,
            ref: { provider, host, project, number },
            page,
          })
          .then((data) => {
            if (!cancelled) setActivity(data);
          })
      : desktop
          .call('pr.comments', {
            sessionId,
            repositoryId,
            ref: { provider, host, project, number },
            page,
          })
          .then((data) => {
            if (!cancelled) setComments(data);
          });
    void work.catch((error: Error) => {
      if (!cancelled) setError(error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, repositoryId, provider, host, project, number, timeline, page, token, revision]);
  const result = timeline ? activity : comments;
  return (
    <div
      className={
        timeline
          ? 'pr-timeline-events relative mx-auto w-full max-w-3xl before:absolute before:left-[15px] before:top-2 before:bottom-5 before:w-px before:bg-border before:content-[""]'
          : 'pr-conversation flex flex-col gap-3'
      }
    >
      {error ? (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setToken(token + 1)}>
            Try again
          </button>
        </p>
      ) : !result ? (
        <PullRequestDiscussionSkeleton timeline={timeline} />
      ) : (
        <>
          {comments?.items.map((comment) => (
            <article
              className="pr-comment m-0 rounded-lg border border-solid border-border/60 bg-background p-0 [overflow-wrap:anywhere] [content-visibility:auto] [contain-intrinsic-block-size:160px]"
              key={comment.id}
            >
              <header className="pr-comment-identity flex flex-wrap items-baseline gap-2 rounded-t-lg bg-muted/60 px-3 py-2.5 text-xs leading-5">
                <strong>{comment.author?.login ?? 'User'}</strong>
                <time
                  className="text-muted-foreground text-[length:var(--text-2xs)]"
                  dateTime={comment.createdAt}
                  title={new Date(comment.createdAt).toLocaleString()}
                >
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </header>
              <RequestMarkdown className="p-3" text={comment.body} baseUrl={`https://${host}`} />
            </article>
          ))}
          {activity?.items.map((item) => (
            <article
              className="timeline-item m-0 mb-5 min-h-10 border-0 pt-0 pr-0 pb-0 pl-12 [content-visibility:auto] [contain-intrinsic-block-size:80px]"
              key={item.id}
            >
              <span
                className="timeline-marker absolute top-0 left-0 flex size-8 items-center justify-center bg-background text-muted-foreground"
                aria-hidden
              >
                <CircleDot size={16} />
              </span>
              <strong className="text-xs leading-5 font-semibold">{item.title}</strong>
              {item.action && (
                <span className="timeline-action ml-1.5 text-xs leading-5">{item.action}</span>
              )}
              <small className="mt-0.5 text-[length:var(--text-2xs)]">
                {item.date ? new Date(item.date).toLocaleString() : ''}
              </small>
              {item.commits?.map((commit) => (
                <button
                  key={commit.sha}
                  className="pr-commit-link group/commit mt-2 flex w-full gap-2 text-left text-xs leading-5"
                  title={`View diff for ${commit.sha}`}
                  onClick={() => onSelectCommit?.(commit)}
                >
                  <code className="text-[var(--link-foreground,var(--primary))] group-hover/commit:underline">
                    {commit.sha.slice(0, 8)}
                  </code>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{commit.title}</span>
                </button>
              ))}
              <RequestMarkdown className="mt-3" text={item.body} baseUrl={`https://${host}`} />
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
