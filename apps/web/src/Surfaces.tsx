import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';
import type { parsePatchFiles } from '@pierre/diffs';
import DiffWorker from './diff.worker?worker';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUpRight,
  Check,
  Columns2,
  ExternalLink,
  FileCode2,
  GitCompareArrows,
  GitPullRequest,
  Globe,
  Maximize2,
  Plus,
  RefreshCw,
  Rows2,
  TerminalSquare,
  X,
} from 'lucide-react';
import type { Session, PullRequest } from '../../../packages/contracts';
import { useApp, surfaceKey, type Surface, showSurface } from './state';
import { runAction } from './Island';
import { navigateTabs, useActiveTab } from './tabs';
const Terminal = lazy(() => import('./Terminal'));
const Editor = lazy(() => import('./Editor'));
const diffOptions = {
  theme: 'github-light' as const,
  themeType: 'light' as const,
  diffStyle: 'unified' as const,
  overflow: 'scroll' as const,
};

export function Patch({ patch, split = false }: { patch: string; split?: boolean }) {
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
            options={{ ...diffOptions, diffStyle: split ? 'split' : 'unified' }}
          />
        ))}
      </div>
    </Virtualizer>
  );
}
function Diff({
  session,
  path,
  initialMode,
}: {
  session: Session;
  path?: string;
  initialMode?: 'unstaged' | 'staged' | 'branch';
}) {
  const status = useApp((a) => a.git[session.id]);
  const [mode, setMode] = useState(initialMode ?? 'unstaged'),
    [base, setBase] = useState('origin/main'),
    [split, setSplit] = useState(false),
    [patch, setPatch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(0);
  const selected = path ?? status?.files[0]?.path;
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError('');
    void window.superfluid
      .call('git.diff', { sessionId: session.id, path: selected, mode, base })
      .then((text) => {
        if (!cancelled) setPatch(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, selected, mode, base, token]);
  return (
    <div className="surface-content">
      <div className="surface-toolbar">
        <select
          aria-label="Diff comparison"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="unstaged">Working tree → Index</option>
          <option value="staged">Index → HEAD</option>
          <option value="branch">Branch → Base</option>
        </select>
        {mode === 'branch' && (
          <input
            aria-label="Diff base reference"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        )}
        <div className="spacer" />
        <button className="icon-button" title="Toggle split diff" onClick={() => setSplit(!split)}>
          {split ? <Rows2 size={14} /> : <Columns2 size={14} />}
        </button>
        <button className="icon-button" title="Refresh diff" onClick={() => setToken(token + 1)}>
          <RefreshCw size={13} />
        </button>
      </div>
      {selected && (
        <button className="diff-path" onClick={() => void useApp.getState().openFile(selected)}>
          <FileCode2 size={13} />
          {selected}
          <ArrowUpRight size={12} />
        </button>
      )}
      {error ? (
        <div className="surface-empty error-text">{error}</div>
      ) : busy ? (
        <div className="surface-empty">Loading changes…</div>
      ) : patch ? (
        <Patch patch={patch} split={split} />
      ) : (
        <div className="surface-empty">
          <Check size={24} />
          <h3>No changes in this comparison</h3>
          <p>{selected ? 'Try Staged or another base reference.' : 'Your worktree is clean.'}</p>
        </div>
      )}
    </div>
  );
}
function PullRequestSurface({ session, number }: { session: Session; number?: number }) {
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
    void window.superfluid
      .call('pr.read', { sessionId: session.id, number })
      .then((p) => {
        if (!cancelled) setPr(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, number, token]);
  useEffect(() => {
    let cancelled = false;
    if (tab === 'code' && pr) {
      void window.superfluid
        .call('pr.patch', { sessionId: session.id, number: pr.number })
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
  }, [tab, pr?.headRefOid]);
  const markdown = (text: string) => (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) void window.superfluid.external(href).catch(useApp.getState().fail);
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
            onClick={() => void window.superfluid.external(pr.url)}
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
                  await window.superfluid.call('pr.comment', {
                    sessionId: session.id,
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
            <button className="text-button" onClick={() => void window.superfluid.external(pr.url)}>
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
function Browser({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null),
    overlay = useApp((a) => !!a.modal || !!a.palette),
    [address, setAddress] = useState(url),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (!host.current) return;
      const r = host.current.getBoundingClientRect();
      void window.superfluid
        .browser({
          visible: !overlay,
          bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    };
    const obs = new ResizeObserver(update);
    if (host.current) obs.observe(host.current);
    update();
    return () => {
      cancelled = true;
      obs.disconnect();
      void window.superfluid.browser({ visible: false });
    };
  }, [overlay]);
  useEffect(() => {
    setError('');
    void window.superfluid.browser({ visible: !overlay, url }).catch((e) => setError(e.message));
    return () => {
      void window.superfluid.browser({ visible: false });
    };
  }, [url]);
  return (
    <div className="surface-content">
      <form
        className="browser-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          void window.superfluid
            .browser({ visible: true, url: address })
            .catch((e) => setError(e.message));
        }}
      >
        <Globe size={14} />
        <input
          aria-label="Preview URL"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="icon-button" title="Load URL">
          <ArrowUpRight size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Open in browser"
          onClick={() => void window.superfluid.external(address).catch(useApp.getState().fail)}
        >
          <ExternalLink size={14} />
        </button>
      </form>
      {error && <div className="inline-error">{error}</div>}
      <div className="browser-viewport" ref={host} />
    </div>
  );
}
const icons = {
  terminal: TerminalSquare,
  diff: GitCompareArrows,
  pr: GitPullRequest,
  browser: Globe,
  file: FileCode2,
};
export default function Surfaces({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]),
    runs = useApp((a) => a.runs),
    [expanded, setExpanded] = useState(false);
  const active = view.surface,
    tabs = view.rightTabs ?? [];
  const tabStrip = useActiveTab(active ? surfaceKey(active) : '');
  const title = (s: Surface) =>
    s.kind === 'terminal'
      ? (runs.find((r) => r.id === s.id)?.name ?? 'Terminal')
      : s.kind === 'file'
        ? s.path.split('/').at(-1)
        : s.kind === 'pr'
          ? s.number
            ? '#' + s.number
            : 'Pull request'
          : s.kind === 'diff'
            ? 'Diff'
            : 'Preview';
  const close = (surface: Surface) => {
    const next = tabs.filter((s) => surfaceKey(s) !== surfaceKey(surface));
    useApp.getState().setView({
      rightTabs: next,
      surface: next.at(-1) ?? null,
      ...(next.length === 0 ? { changes: false } : {}),
    });
  };
  return (
    <section
      className={`right-surfaces ${expanded ? 'expanded' : ''}`}
      aria-label="Secondary surfaces"
    >
      <div className="surface-header">
        <div
          ref={tabStrip}
          className="surface-tabs"
          role="tablist"
          aria-label="Surfaces"
          onKeyDown={navigateTabs}
        >
          {tabs.map((s) => {
            const Icon = icons[s.kind];
            return (
              <div
                className={`surface-tab ${active && surfaceKey(active) === surfaceKey(s) ? 'active' : ''}`}
                key={surfaceKey(s)}
              >
                <button
                  role="tab"
                  aria-selected={!!active && surfaceKey(active) === surfaceKey(s)}
                  tabIndex={active && surfaceKey(active) === surfaceKey(s) ? 0 : -1}
                  aria-controls="secondary-surface-panel"
                  title={title(s)}
                  onClick={() => useApp.getState().setView({ surface: s })}
                >
                  <Icon size={13} />
                  <span>{title(s)}</span>
                </button>
                <button
                  className="tab-close"
                  aria-label={`Close ${title(s)}`}
                  onClick={() => close(s)}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="tab-tools">
          <button
            className="icon-button"
            title="Open a surface"
            onClick={() => useApp.setState({ modal: { kind: 'launcher' } })}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            title="Expand surface"
            onClick={() => setExpanded(!expanded)}
          >
            <Maximize2 size={13} />
          </button>
          <button
            className="icon-button"
            title="Hide secondary surface"
            onClick={() => useApp.getState().setView({ surface: null })}
          >
            <Columns2 size={13} />
          </button>
        </div>
      </div>
      <div
        className="surface-panel"
        id="secondary-surface-panel"
        role="tabpanel"
        aria-label={active ? title(active) : 'Open a surface'}
      >
        <Suspense fallback={<div className="surface-empty">Opening surface…</div>}>
          {active?.kind === 'terminal' ? (
            <Terminal id={active.id} />
          ) : active?.kind === 'diff' ? (
            <Diff
              key={surfaceKey(active)}
              session={session}
              path={active.path}
              initialMode={active.mode}
            />
          ) : active?.kind === 'pr' ? (
            <PullRequestSurface key={surfaceKey(active)} session={session} number={active.number} />
          ) : active?.kind === 'browser' ? (
            <Browser url={active.url} />
          ) : active?.kind === 'file' ? (
            <Editor session={session} path={active.path} primary={false} />
          ) : (
            <SurfaceLauncher session={session} />
          )}
        </Suspense>
      </div>
    </section>
  );
}
export function SurfaceLauncher({ session }: { session: Session }) {
  return (
    <div className="surface-launcher">
      <h3>Open a surface</h3>
      {[
        {
          icon: Globe,
          label: 'Browser',
          run: () => showSurface({ kind: 'browser', url: 'http://localhost:8000' }),
        },
        { icon: TerminalSquare, label: 'Terminal', run: () => void runAction(session) },
        {
          icon: FileCode2,
          label: 'Files',
          run: () => {
            const view = useApp.getState().views[session.id];
            if (view.active) showSurface({ kind: 'file', path: view.active });
            else useApp.setState({ palette: 'files' });
          },
        },
        {
          icon: GitCompareArrows,
          label: 'Diff',
          run: () => showSurface({ kind: 'diff' }),
        },
        {
          icon: GitPullRequest,
          label: 'Pull request',
          run: () => showSurface({ kind: 'pr' }),
        },
      ].map(({ icon: Icon, label, run }) => (
        <button
          className="launcher-row"
          key={label}
          aria-label={label}
          onClick={() => {
            useApp.setState({ modal: null });
            run();
          }}
        >
          <Icon size={16} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
