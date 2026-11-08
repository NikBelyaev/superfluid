// Adapted from T3 Code's PullRequestPrimaryAction and PullRequestActionsMenu (MIT).
import { useEffect, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Check,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  List,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react';
import type {
  PullRequest,
  PullRequestMergeAction,
  PullRequestMergeMethod,
  PullRequestMergeState,
} from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';

const labels = { merge: 'Merge', squash: 'Squash and merge', rebase: 'Rebase and merge' };

export function PullRequestToolbar({
  request,
  sessionId,
  repositoryId,
  revision,
  onBack,
  onRefresh,
  onDraftChange,
}: {
  request: PullRequest;
  sessionId: string;
  repositoryId?: string;
  revision: number;
  onBack: () => void;
  onRefresh: () => void;
  onDraftChange: (draft: boolean) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<PullRequestMergeState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<PullRequestMergeMethod | null>(null);
  const [pending, setPending] = useState<PullRequestMergeAction['action'] | 'draft' | null>(null);
  const [armed, setArmed] = useState<{
    action: PullRequestMergeAction['action'];
    headSha: string;
    method: PullRequestMergeMethod | null;
  } | null>(null);
  const writing = useRef(false);
  const busy = pending !== null;
  const { provider, host, project, number } = request.ref;
  useEffect(() => {
    if (busy) return;
    let cancelled = false,
      running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (cancelled || running || document.hidden) return;
      running = true;
      clearTimeout(timer);
      try {
        const value = await desktop.call('pr.mergeState', {
          sessionId,
          repositoryId,
          ref: { provider, host, project, number },
        });
        if (!cancelled) {
          setSnapshot(value);
          setLoadError('');
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
        if (!cancelled && !document.hidden) timer = setTimeout(() => void load(), 30_000);
      }
    };
    const wake = () => {
      if (document.hidden) clearTimeout(timer);
      else void load();
    };
    void load();
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [
    sessionId,
    repositoryId,
    provider,
    host,
    project,
    number,
    request.headRefOid,
    request.state,
    request.draft,
    revision,
    busy,
  ]);
  const method =
    selection && snapshot?.methods.includes(selection)
      ? selection
      : (snapshot?.defaultMethod ?? null);
  const headChanged = !!snapshot?.headSha && snapshot.headSha !== request.headRefOid;
  const can = (action: PullRequestMergeAction['action']) =>
    !!snapshot &&
    !loadError &&
    snapshot.state === 'open' &&
    !!snapshot.headSha &&
    (action === 'cancel-auto' || !headChanged) &&
    (action === 'merge'
      ? snapshot.canMerge
      : action === 'auto'
        ? snapshot.canAutoMerge
        : snapshot.canManage && snapshot.autoMerge);
  const confirmation =
    armed && armed.headSha === snapshot?.headSha && armed.method === method && can(armed.action)
      ? armed
      : null;
  const action =
    confirmation?.action ?? (!snapshot?.canMerge && snapshot?.canAutoMerge ? 'auto' : 'merge');
  const arm = (action: PullRequestMergeAction['action']) => {
    if (!snapshot?.headSha || !can(action) || busy) return;
    setError('');
    setArmed({ action, headSha: snapshot.headSha, method });
  };
  const perform = async () => {
    if (!confirmation || !snapshot?.headSha || writing.current) return;
    if (action !== 'cancel-auto' && !method) return;
    writing.current = true;
    setPending(action);
    setError('');
    setArmed(null);
    try {
      const change: PullRequestMergeAction =
        action === 'cancel-auto'
          ? { action, expectedHeadSha: snapshot.headSha }
          : { action, method: method!, expectedHeadSha: snapshot.headSha };
      setSnapshot(
        await desktop.call('pr.merge', { sessionId, repositoryId, ref: request.ref, ...change }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setSnapshot(null);
    } finally {
      writing.current = false;
      setPending(null);
    }
  };
  const changeDraft = async () => {
    if (writing.current || !snapshot) return;
    writing.current = true;
    setPending('draft');
    setError('');
    try {
      await onDraftChange(!snapshot.draft);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      writing.current = false;
      setPending(null);
    }
  };
  const state = snapshot?.state ?? request.state;
  const draft = snapshot?.draft ?? request.draft;
  const StateIcon =
    state === 'merged'
      ? GitMerge
      : state === 'closed'
        ? GitPullRequestClosed
        : draft
          ? GitPullRequestDraft
          : GitPullRequest;
  const passive =
    !confirmation && (state !== 'open' || (draft && !snapshot?.canManage) || snapshot?.autoMerge);
  const ready = draft && snapshot?.canManage && !confirmation;
  let label = 'Merge blocked';
  if (pending)
    label = { merge: 'Merging…', auto: 'Enabling…', 'cancel-auto': 'Canceling…', draft: 'Saving…' }[
      pending
    ];
  else if (state === 'merged') label = 'Merged';
  else if (state === 'closed') label = 'Closed';
  else if (loadError) label = 'Unavailable';
  else if (!snapshot) label = 'Checking…';
  else if (snapshot.autoMerge && !confirmation) label = 'Auto-merge enabled';
  else if (headChanged && action !== 'cancel-auto') label = 'Head changed';
  else if (confirmation)
    label =
      action === 'merge'
        ? 'Confirm merge?'
        : action === 'auto'
          ? 'Confirm auto-merge?'
          : 'Confirm cancel?';
  else if (ready) label = 'Ready for review';
  else if (draft) label = 'Draft';
  else if (snapshot.hasConflicts) label = 'Conflicts';
  else if (can(action))
    label = action === 'auto' ? 'Enable auto-merge' : method ? labels[method] : 'Merge';
  const enabled =
    !busy &&
    !loadError &&
    !!snapshot &&
    (ready || (can(action) && (action === 'cancel-auto' || !!method)));
  const reason =
    loadError ||
    (headChanged ? 'Refresh and review the new commits before merging.' : snapshot?.reason) ||
    undefined;
  const providerName = provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const stateColor =
    state === 'merged'
      ? 'text-[var(--pr-foreground)]'
      : state === 'closed'
        ? 'text-[var(--error-foreground)]'
        : 'text-[var(--success-foreground)]';
  const mergeClasses =
    'inline-flex flex-none items-center justify-center gap-[5px] border border-solid px-2 py-1 text-xs leading-4 whitespace-nowrap';
  return (
    <>
      <div className="pr-detail-toolbar flex min-w-0 items-center gap-1 pr-4 pl-3">
        <span
          className="pr-detail-repository min-w-0 truncate text-xs leading-5 font-medium text-muted-foreground hover:text-foreground"
          title={`${host}/${project}`}
        >
          {project}
        </span>
        <span
          className={`pr-detail-reference ${state} inline-flex flex-none items-center gap-1 rounded-sm px-1 py-0.5 text-xs leading-5 hover:bg-accent ${stateColor}`}
        >
          <StateIcon size={14} aria-hidden />
          {provider === 'gitlab' ? '!' : '#'}
          {number}
        </span>
        <div className="spacer" />
        {passive && !busy ? (
          <span
            className={`pr-merge-state ${state} ${snapshot?.autoMerge ? 'auto text-primary' : state === 'open' ? 'text-muted-foreground' : stateColor} ${mergeClasses} rounded-full border-border`}
            role="status"
            title={loadError || undefined}
          >
            {snapshot?.autoMerge ? (
              <GitMerge size={13} aria-hidden />
            ) : (
              <StateIcon size={13} aria-hidden />
            )}
            {label}
          </span>
        ) : (
          <button
            className={`pr-merge-primary ${mergeClasses} rounded-md border-transparent bg-primary text-primary-foreground aria-disabled:cursor-help aria-disabled:border-border aria-disabled:bg-muted aria-disabled:text-muted-foreground disabled:border-border disabled:bg-muted disabled:text-muted-foreground`}
            aria-label={label}
            aria-disabled={!enabled || undefined}
            disabled={busy || (!snapshot && !loadError)}
            title={!enabled ? reason : undefined}
            aria-description={!enabled ? reason : undefined}
            onClick={() => {
              if (!enabled) return;
              if (ready) void changeDraft();
              else if (confirmation) void perform();
              else arm(action);
            }}
            onBlur={() => setArmed(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setArmed(null);
            }}
          >
            {confirmation ? <Check size={13} aria-hidden /> : <GitMerge size={13} aria-hidden />}
            {label}
          </button>
        )}
        <Menu.Root>
          <Menu.Trigger className="icon-button" aria-label="More request actions">
            <MoreHorizontal size={15} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="menu-positioner" align="end" sideOffset={5}>
              <Menu.Popup className="small-menu pr-actions-menu w-60 [&_[data-highlighted]]:bg-accent [&_[data-disabled]]:cursor-default [&_[data-disabled]]:opacity-45">
                <Menu.Item
                  onClick={() => {
                    setArmed(null);
                    setError('');
                    onRefresh();
                  }}
                  disabled={busy}
                >
                  <RefreshCw size={14} />
                  Refresh request
                </Menu.Item>
                <Menu.Item onClick={onBack}>
                  <List size={14} />
                  Repository requests
                </Menu.Item>
                <Menu.Item
                  onClick={() => void desktop.external(request.url).catch(useApp.getState().fail)}
                >
                  <ExternalLink size={14} />
                  Open on {providerName}
                </Menu.Item>
                {snapshot?.state === 'open' && (
                  <>
                    <Menu.Separator className="repository-actions-separator" />
                    <Menu.Item disabled={busy} onClick={() => void changeDraft()}>
                      <GitPullRequestDraft size={14} />
                      {draft ? 'Ready for review' : 'Convert to draft'}
                    </Menu.Item>
                    {snapshot.autoMerge ? (
                      <Menu.Item
                        disabled={busy || !snapshot.canManage}
                        onClick={() => arm('cancel-auto')}
                      >
                        <GitMerge size={14} />
                        Cancel auto-merge
                      </Menu.Item>
                    ) : (
                      snapshot.canAutoMerge && (
                        <Menu.Item disabled={busy} onClick={() => arm('auto')}>
                          <GitMerge size={14} />
                          Enable auto-merge
                        </Menu.Item>
                      )
                    )}
                    {snapshot.methods.length > 1 && (
                      <>
                        <Menu.Separator className="repository-actions-separator" />
                        <Menu.RadioGroup
                          value={method ?? ''}
                          onValueChange={(value) => {
                            setSelection(value as PullRequestMergeMethod);
                            setArmed(null);
                          }}
                        >
                          {snapshot.methods.map((value) => (
                            <Menu.RadioItem
                              className="flex min-h-7 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm leading-5 outline-none"
                              key={value}
                              value={value}
                              disabled={busy}
                              closeOnClick
                            >
                              <span className="pr-menu-indicator w-3.5 flex-none">
                                <Menu.RadioItemIndicator>
                                  <Check size={13} />
                                </Menu.RadioItemIndicator>
                              </span>
                              {labels[value]}
                            </Menu.RadioItem>
                          ))}
                        </Menu.RadioGroup>
                      </>
                    )}
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {error && (
        <p
          className="pr-detail-error m-0 bg-[var(--warning-surface)] px-4 py-2 text-xs leading-5 text-[var(--warning-foreground)]"
          role="alert"
        >
          {error}
        </p>
      )}
    </>
  );
}
