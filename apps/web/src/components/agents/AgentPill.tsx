import { useEffect, useId, useState } from 'react';
import { Check, Clock3, MessageSquare, X } from 'lucide-react';
import type { Agent } from '@superfluid/contracts';
import { codexIcons } from './codex/codexIcons';
import { AgentHistory } from './AgentHistory';
import { AgentPanel } from './AgentPanel';
import { AgentResponse } from './AgentResponse';
import { AgentQuestionForm } from './AgentQuestionForm';
import { finished, type AgentCard, type AgentDetail } from './agentPriority';

function Elapsed({ agent, active }: { agent: Agent; active: boolean }) {
  const [now, setNow] = useState(Date.now());
  const ended = finished(agent) || agent.status === 'queued';
  useEffect(() => {
    if (ended || !active) return;
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ended, active, agent.startedAt]);
  const seconds = Math.max(
    0,
    Math.floor(((ended ? agent.updatedAt : now) - agent.startedAt) / 1000),
  );
  return (
    <span className="codex-elapsed shrink-0 text-muted-foreground tabular-nums" aria-hidden>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

const actionClass =
  'grid size-6 shrink-0 place-items-center bg-transparent text-muted-foreground hover:text-foreground aria-expanded:text-foreground';
const doneActionClass =
  actionClass +
  ' [@media(hover:hover)]:opacity-0 group-hover/pill:opacity-100 group-focus-within/pill:opacity-100';

export function AgentPill({
  card,
  front,
  active,
  multiple,
  mode,
  handling,
  deferred,
  position,
  pending,
  error,
  onTrigger,
  onAgents,
  onMessage,
  onLater,
  onDismiss,
  onRespond,
  onSubmit,
  onOpenRun,
}: {
  card: AgentCard;
  front: boolean;
  active: boolean;
  multiple: boolean;
  mode: AgentDetail['mode'] | null;
  handling: boolean;
  deferred: boolean;
  position: string;
  pending: boolean;
  error?: string;
  onTrigger: () => void;
  onAgents: () => void;
  onMessage: () => void;
  onLater: () => void;
  onDismiss: () => void;
  onRespond: (decision: 'allow' | 'deny') => void;
  onSubmit: (send: () => Promise<void>) => void;
  onOpenRun: () => void;
}) {
  const { agent, name, icon } = card;
  const panelId = useId();
  const step = agent.steps.findLast((step) => !step.endedAt);
  const done = agent.status === 'done';
  const waiting = agent.status === 'needs-input';
  const working = agent.status === 'working';
  const Icon =
    agent.status === 'queued'
      ? Clock3
      : done
        ? Check
        : finished(agent)
          ? X
          : waiting && agent.question
            ? MessageSquare
            : codexIcons[agent.approval?.activity ?? step?.activity ?? 'thinking'];
  const duration = Math.max(0, Math.floor((agent.updatedAt - agent.startedAt) / 1000));
  const label = done
    ? `Done in ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
    : deferred && !handling
      ? agent.question
        ? 'Question deferred'
        : 'Approval deferred'
      : agent.status === 'queued'
        ? 'Queued'
        : agent.status === 'failed'
          ? 'Failed'
          : agent.status === 'stopped'
            ? 'Stopped'
            : waiting
              ? agent.question
                ? 'Needs your input'
                : (agent.approval?.label ?? `Continue in ${name}`)
              : (step?.label ?? 'Working');
  const brand = (
    <span className="relative grid size-6 shrink-0 place-items-center text-foreground">
      {working && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-solid border-transparent border-t-current border-r-current ${active ? 'animate-agent-spin motion-reduce:animate-none' : ''}`}
        />
      )}
      {icon}
    </span>
  );
  return (
    <div
      className="codex-status-position w-full shrink-0"
      data-provider={name}
      data-status={agent.status}
    >
      <div
        className={`codex-pill group/pill flex min-h-9 flex-col rounded-[18px] border border-solid p-1 text-[length:var(--text-sm)] shadow-[0_4px_18px_#00000010] transition-[background-color,border-color] duration-[260ms] motion-reduce:transition-none ${waiting ? 'border-[color-mix(in_srgb,var(--warning-foreground)_35%,var(--border))] bg-warning-surface' : done ? 'border-[color-mix(in_srgb,var(--success-foreground)_35%,var(--border))] bg-[color-mix(in_srgb,var(--success-foreground)_12%,var(--card))] hover:border-success-foreground/60 hover:bg-[color-mix(in_srgb,var(--success-foreground)_20%,var(--card))] has-focus-visible:border-success-foreground/60 has-focus-visible:bg-[color-mix(in_srgb,var(--success-foreground)_20%,var(--card))]' : 'border-border bg-card hover:border-input hover:bg-accent has-focus-visible:border-input has-focus-visible:bg-accent'}`}
      >
        <div
          className={`codex-pill-main flex items-center transition-opacity duration-150 ${!front && !active ? 'invisible opacity-0' : 'visible opacity-100'}`}
        >
          {front && multiple && (
            <button
              className="mr-[7px] shrink-0 rounded-full p-0"
              aria-label="Show agents"
              data-agents
              onClick={onAgents}
            >
              {brand}
            </button>
          )}
          <button
            data-agent-trigger
            className="codex-pill-trigger flex min-w-0 flex-1 items-center gap-[9px] rounded-[20px] py-px pr-1.5 pl-0.5 whitespace-nowrap text-muted-foreground"
            aria-label={`${name}: ${label}`}
            aria-expanded={!!mode}
            aria-controls={panelId}
            title={agent.title || agent.model}
            onClick={onTrigger}
          >
            {!(front && multiple) && brand}
            <Icon size={14} aria-hidden />
            <span className="codex-activity min-w-0 flex-1 overflow-hidden text-left" role="status">
              <span
                className={`codex-status-label block truncate ${done ? 'text-success-foreground' : working && active ? 'bg-[linear-gradient(100deg,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%)] bg-size-[200%_100%] bg-clip-text text-transparent animate-agent-shimmer motion-reduce:bg-none motion-reduce:text-muted-foreground motion-reduce:animate-none' : ''}`}
              >
                {label}
              </span>
            </span>
            {!done && <Elapsed agent={agent} active={active} />}
          </button>
          {(finished(agent) || (waiting && agent.question)) && (
            <>
              <button
                className={done ? doneActionClass : actionClass}
                aria-label={`Message ${name}`}
                title={`Message ${name}`}
                aria-expanded={agent.question ? mode === 'request' : mode === 'message'}
                aria-controls={panelId}
                disabled={pending}
                onClick={onMessage}
              >
                <MessageSquare size={14} aria-hidden />
              </button>
              {finished(agent) && (
                <button
                  className={done ? doneActionClass : actionClass}
                  aria-label={`Dismiss ${name} status`}
                  title={`Dismiss ${name} status`}
                  disabled={pending}
                  onClick={onDismiss}
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
        <div id={panelId}>
          <AgentPanel open={front && (mode === 'response' || mode === 'request')}>
            {waiting && agent.question ? (
              <AgentQuestionForm
                key={agent.question.id}
                card={card}
                question={agent.question}
                onSubmit={onSubmit}
                onSkip={onLater}
              />
            ) : (
              <AgentResponse agent={agent} name={name} request={waiting} onOpenRun={onOpenRun} />
            )}
          </AgentPanel>
          <AgentPanel open={handling && !!agent.approval}>
            <div className="codex-approval-actions flex items-center gap-1 px-1 pb-1">
              <span className="min-w-7 pl-1 text-[length:var(--text-2xs)] text-muted-foreground tabular-nums">
                {position}
              </span>
              <button
                className="shrink-0 px-1 py-[5px] text-muted-foreground hover:text-foreground"
                disabled={pending}
                onClick={onLater}
              >
                Later
              </button>
              <button
                className="flex-1 rounded-[18px] border border-solid border-border px-3 py-[5px]"
                disabled={pending}
                onClick={() => onRespond('deny')}
              >
                Deny
              </button>
              <button
                className="flex-1 rounded-[18px] border border-solid border-border bg-foreground px-3 py-[5px] text-background"
                disabled={pending}
                onClick={() => onRespond('allow')}
              >
                Approve
              </button>
            </div>
          </AgentPanel>
          <AgentPanel open={front && mode === 'history' && working}>
            <div className="codex-expanded mx-1 mt-1 max-h-[min(360px,45vh)] overflow-auto pt-2 pb-1 focus-visible:outline-none">
              <AgentHistory agent={agent} name={name} onOpenRun={onOpenRun} />
            </div>
          </AgentPanel>
        </div>
        <AgentPanel open={front && mode === 'message'} chat>
          {card.message(onSubmit)}
        </AgentPanel>
        {error && (
          <p
            role="alert"
            className="mx-1 my-1.5 text-[length:var(--text-xs)] text-error-foreground [overflow-wrap:anywhere]"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
