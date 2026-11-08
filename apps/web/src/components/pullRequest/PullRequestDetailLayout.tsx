// Adapted from T3 Code PullRequestDetailLayout, DetailCrumbs and SummaryTab (MIT).
import type { ReactNode } from 'react';
import { ArrowLeft, ChevronDown, FileDiff } from 'lucide-react';
import type { PullRequest } from '@superfluid/contracts';
import { navigateTabs } from '~/hooks/useTabs';
import { PullRequestToolbar } from './PullRequestToolbar';
import { PullRequestInlineEdit } from './PullRequestInlineEdit';
import { Skeleton } from '~/components/ui/Skeleton';

export function PullRequestDetailHeader({
  request,
  sessionId,
  repositoryId,
  revision,
  onBack,
  onRefresh,
  onDraftChange,
  onTitleSave,
  onBaseSave,
  loading = false,
}: {
  request: PullRequest;
  sessionId: string;
  repositoryId?: string;
  revision: number;
  onBack: () => void;
  onRefresh: () => void;
  onDraftChange: (draft: boolean) => Promise<void>;
  onTitleSave: (value: string, version: string) => Promise<void>;
  onBaseSave: (value: string, version: string) => Promise<void>;
  loading?: boolean;
}) {
  return (
    <header className="pr-detail-header min-w-0 flex-none pt-2">
      <PullRequestToolbar
        request={request}
        sessionId={sessionId}
        repositoryId={repositoryId}
        revision={revision}
        onBack={onBack}
        onRefresh={onRefresh}
        onDraftChange={onDraftChange}
      />
      <div className="pr-detail-header-body min-w-0 px-4 pt-1 pb-4">
        <PullRequestInlineEdit
          value={request.title}
          version={request.updatedAt}
          label="Title"
          onSave={onTitleSave}
        />
        <div className="pr-detail-meta mt-2 flex min-h-5 flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
          <span className="pr-actor inline-flex items-center gap-1.5">
            <span className="avatar" aria-hidden>
              {request.author?.login[0] ?? '?'}
            </span>
            {request.author?.login ?? 'Unknown author'}
          </span>
          <span className="pr-meta-divider h-3 w-px bg-border" aria-hidden />
          <span>
            updated{' '}
            <time dateTime={request.updatedAt} title={new Date(request.updatedAt).toLocaleString()}>
              {new Date(request.updatedAt).toLocaleDateString()}
            </time>
          </span>
        </div>
        <div className="pr-detail-branches mt-4 flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
          <div className="pr-detail-branch-pair flex min-w-0 flex-1 items-center gap-1.5">
            <PullRequestInlineEdit
              value={request.baseRefName}
              version={request.updatedAt}
              label="Target branch"
              variant="branch"
              onSave={onBaseSave}
            />
            <ArrowLeft size={14} aria-label="receives changes from" />
            <code
              className="min-w-0 truncate [font:inherit] [font-family:var(--font-mono)]"
              title={request.headRefName}
            >
              {request.headRefName}
            </code>
          </div>
          <span className="pr-detail-diff-stat ml-auto inline-flex items-center justify-end gap-2 tabular-nums [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:whitespace-nowrap">
            {loading && (
              <span role="status" aria-label="Loading request statistics">
                <Skeleton className="h-3 w-32" />
              </span>
            )}
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
    <nav className="pr-nav flex-wrap gap-2" aria-label={`${label} tabs`}>
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
            aria-controls={`pr-panel-${tab.value}`}
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
    <details
      className="pr-section group/section border-0 border-b border-solid border-border/60"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-xs leading-5 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} className="-rotate-90 group-open/section:rotate-0" aria-hidden />
        <span>{title}</span>
      </summary>
      <div className="pr-section-body px-4 pb-4 text-xs leading-5">{children}</div>
    </details>
  );
}
