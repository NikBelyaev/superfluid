// Adapted from T3 Code PullRequestDetailLayout, DetailCrumbs and SummaryTab (MIT).
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  CircleDot,
  ExternalLink,
  FileDiff,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import type { PullRequest } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { navigateTabs } from '~/hooks/useTabs';

export function PullRequestDetailHeader({
  request,
  onBack,
  onRefresh,
  onEdit,
}: {
  request: PullRequest;
  onBack: () => void;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const provider = request.ref.provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const term = request.ref.provider === 'gitlab' ? 'MR' : 'PR';
  const state = request.draft && request.state === 'open' ? 'draft' : request.state;
  const StateIcon =
    state === 'merged'
      ? GitMerge
      : state === 'closed'
        ? GitPullRequestClosed
        : state === 'draft'
          ? GitPullRequestDraft
          : GitPullRequest;
  return (
    <header className="pr-detail-header">
      <div className="pr-detail-toolbar">
        <button
          className="icon-button"
          title="Repository requests"
          aria-label="Repository requests"
          onClick={onBack}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="pr-detail-repository" title={`${request.ref.host}/${request.ref.project}`}>
          {request.ref.project}
        </span>
        <button
          className={`pr-detail-reference ${state}`}
          title={`Open on ${provider}`}
          onClick={() => void desktop.external(request.url).catch(useApp.getState().fail)}
        >
          <StateIcon size={14} aria-hidden />
          {request.ref.provider === 'gitlab' ? '!' : '#'}
          {request.number}
        </button>
        <div className="spacer" />
        <span className={`pr-detail-state ${state}`}>
          <StateIcon size={13} aria-hidden />
          {state}
        </span>
        <button
          className="icon-button"
          title={`Edit ${term}`}
          aria-label={`Edit ${term}`}
          onClick={onEdit}
        >
          <Pencil size={14} />
        </button>
        <button
          className="icon-button"
          title="Refresh request"
          aria-label="Refresh request"
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-button"
          title={`Open on ${provider}`}
          aria-label={`Open on ${provider}`}
          onClick={() => void desktop.external(request.url).catch(useApp.getState().fail)}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      <div className="pr-detail-header-body">
        <h2>{request.title}</h2>
        <div className="pr-detail-meta">
          <span className="pr-actor">
            <span className="avatar" aria-hidden>
              {request.author?.login[0] ?? '?'}
            </span>
            {request.author?.login ?? 'Unknown author'}
          </span>
          <span className="pr-meta-divider" aria-hidden />
          <span>
            updated{' '}
            <time dateTime={request.updatedAt} title={new Date(request.updatedAt).toLocaleString()}>
              {new Date(request.updatedAt).toLocaleDateString()}
            </time>
          </span>
        </div>
        <div className="pr-detail-branches">
          <span className="pr-detail-branch-pair">
            <code title={request.baseRefName}>{request.baseRefName}</code>
            <ArrowLeft size={14} aria-label="receives changes from" />
            <code title={request.headRefName}>{request.headRefName}</code>
          </span>
          <span className="pr-detail-diff-stat">
            {request.changedFiles !== null && (
              <span>
                <FileDiff size={14} aria-hidden />
                {request.changedFiles} files
              </span>
            )}
            {request.additions !== null && (
              <span className="positive">+{request.additions.toLocaleString()}</span>
            )}
            {request.deletions !== null && (
              <span className="negative">−{request.deletions.toLocaleString()}</span>
            )}
          </span>
        </div>
      </div>
    </header>
  );
}

export function PullRequestDetailTabBar<Tab extends string>({
  tabs,
  value,
  onValueChange,
  label,
  children,
}: {
  tabs: ReadonlyArray<{ value: Tab; label: string }>;
  value: Tab;
  onValueChange: (tab: Tab) => void;
  label: string;
  children?: ReactNode;
}) {
  return (
    <nav className="pr-nav" aria-label={`${label} tabs`}>
      <div
        className="pr-tabs"
        role="tablist"
        aria-label={label}
        onKeyDown={(event) => navigateTabs(event, true)}
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={value === tab.value}
            tabIndex={value === tab.value ? 0 : -1}
            id={`pr-tab-${tab.value}`}
            aria-controls="pr-panel"
            className={value === tab.value ? 'active' : ''}
            onClick={() => onValueChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </nav>
  );
}

export function PullRequestSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="pr-section" open={defaultOpen}>
      <summary>
        <ChevronDown size={14} aria-hidden />
        <span>{title}</span>
      </summary>
      <div className="pr-section-body">{children}</div>
    </details>
  );
}

export function PullRequestChecks({ checks }: { checks: PullRequest['statusCheckRollup'] }) {
  return (
    <PullRequestSection title="Checks" defaultOpen={false}>
      {checks.length === 0 ? (
        <p className="muted">No checks reported.</p>
      ) : (
        checks.map((check, index) => (
          <div className="check-row" key={index}>
            {check.state === 'SUCCESS' ? (
              <CircleCheck size={14} className="positive" aria-hidden />
            ) : (
              <CircleDot size={14} aria-hidden />
            )}
            <span>{check.name}</span>
            <small>{check.state.toLowerCase().replaceAll('_', ' ')}</small>
          </div>
        ))
      )}
    </PullRequestSection>
  );
}
