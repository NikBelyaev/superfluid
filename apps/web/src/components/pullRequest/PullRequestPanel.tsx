import { desktop } from '~/rpc/desktop';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, ExternalLink, GitPullRequest } from 'lucide-react';
import type { Session, PullRequest } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { navigateTabs } from '~/hooks/useTabs';
import { Patch } from '~/components/diffs/Patch';

export function PullRequestSurface({
  session,
  number,
  repositoryId,
}: {
  session: Session;
  number?: number;
  repositoryId?: string;
}) {
  const [pr, setPr] = useState<PullRequest | null>(null),
    [tab, setTab] = useState<'summary' | 'timeline' | 'code'>('summary'),
    [error, setError] = useState(''),
    [patch, setPatch] = useState(''),
    [comment, setComment] = useState(''),
    [posting, setPosting] = useState(false),
    [token, setToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void desktop
      .call('pr.read', { sessionId: session.id, number, repositoryId })
      .then((p) => {
        if (!cancelled) setPr(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, number, repositoryId, token]);
  useEffect(() => {
    let cancelled = false;
    if (tab === 'code' && pr) {
      void desktop
        .call('pr.patch', { sessionId: session.id, number: pr.number, repositoryId })
        .then((p) => {
          if (!cancelled) setPatch(p);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab, pr?.headRefOid, repositoryId, session.id]);
  const markdown = (text: string) => (
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
  if (error)
    return (
      <div className="surface-empty">
        <GitPullRequest size={25} />
        <h3>Pull request unavailable</h3>
        <p>{error}</p>
        <p className="muted">GitHub access uses your authenticated GitHub CLI (gh).</p>
        <button className="button" onClick={() => setToken(token + 1)}>
          Try again
        </button>
      </div>
    );
  if (!pr) return <div className="surface-empty">Loading pull request…</div>;
  return (
    <div className="surface-content pr-surface">
      <div className="pr-heading">
        <div className="pr-repository">
          <GitPullRequest size={13} />#{pr.number}
          <div className="spacer" />
          <span className={`pr-state ${pr.state.toLowerCase()}`}>{pr.state.toLowerCase()}</span>
          <button
            className="icon-button"
            title="Open on GitHub"
            onClick={() => void desktop.external(pr.url)}
          >
            <ExternalLink size={13} />
          </button>
        </div>
        <h2>{pr.title}</h2>
        <div className="pr-author">
          <span className="avatar">{pr.author?.login?.[0] ?? 'G'}</span>
          {pr.author?.login ?? 'GitHub'}
          <div className="spacer" />
          <span className="positive">+{pr.additions}</span>
          <span className="negative">−{pr.deletions}</span>
        </div>
        <div className="pr-branches">
          {pr.baseRefName} ← {pr.headRefName}
        </div>
      </div>
      <div className="pr-nav">
        <div
          className="pr-tabs"
          role="tablist"
          aria-label="Pull request"
          onKeyDown={(e) => navigateTabs(e, true)}
        >
          {(['summary', 'timeline', 'code'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              id={`pr-tab-${t}`}
              aria-controls="pr-panel"
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted">{pr.changedFiles} files</span>
      </div>
      <div className="pr-panel" id="pr-panel" role="tabpanel" aria-labelledby={`pr-tab-${tab}`}>
        {tab === 'summary' && (
          <div className="pr-scroll">
            <div className="markdown">{markdown(pr.body || 'No description provided.')}</div>
            {pr.statusCheckRollup?.length > 0 && (
              <details className="checks">
                <summary>Checks · {pr.statusCheckRollup.length}</summary>
                {pr.statusCheckRollup.map((c: any, i) => (
                  <div key={i} className="check-row">
                    <span className={c.conclusion === 'SUCCESS' ? 'positive' : 'muted'}>
                      {c.conclusion === 'SUCCESS' ? '✓' : '○'}
                    </span>
                    {c.name ?? c.context}
                    <small>{c.conclusion ?? c.status ?? c.state}</small>
                  </div>
                ))}
              </details>
            )}
            <h4>Comments ({pr.comments?.length ?? 0})</h4>
            {pr.comments?.map((c: any, i) => (
              <article className="pr-comment" key={i}>
                <strong>{c.author?.login ?? 'GitHub'}</strong>
                <div className="markdown">{markdown(c.body ?? '')}</div>
              </article>
            ))}
            <form
              className="comment-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setPosting(true);
                try {
                  await desktop.call('pr.comment', {
                    sessionId: session.id,
                    repositoryId,
                    number: pr.number,
                    body: comment,
                  });
                  setComment('');
                  setToken(token + 1);
                } catch (e) {
                  useApp.getState().fail(e);
                } finally {
                  setPosting(false);
                }
              }}
            >
              <label htmlFor="pr-comment">Add a comment</label>
              <textarea
                id="pr-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Write a comment…"
              />
              <button className="button primary" disabled={posting || !comment.trim()}>
                {posting ? 'Posting…' : 'Post comment'}
              </button>
            </form>
          </div>
        )}
        {tab === 'timeline' && (
          <div className="pr-scroll timeline">
            {pr.commits?.map((c: any, i) => (
              <div className="timeline-item" key={c.oid ?? i}>
                <span className="timeline-node" />
                <strong>{c.messageHeadline}</strong>
                <small>
                  {c.oid?.slice(0, 7)} ·{' '}
                  {c.committedDate ? new Date(c.committedDate).toLocaleString() : ''}
                </small>
              </div>
            ))}
            {pr.reviews?.map((r: any, i) => (
              <div className="timeline-item" key={'review' + i}>
                <span className="timeline-node" />
                <strong>
                  {r.author?.login} · {r.state}
                </strong>
                <div className="markdown">{markdown(r.body ?? '')}</div>
              </div>
            ))}
            <button className="text-button" onClick={() => void desktop.external(pr.url)}>
              Open full timeline on GitHub <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        {tab === 'code' &&
          (patch ? <Patch patch={patch} /> : <div className="surface-empty">Loading PR diff…</div>)}
      </div>
    </div>
  );
}
