import { ArrowUpRight, X } from 'lucide-react';
import type { Agent } from '@superfluid/contracts';
import { codexIcons } from './codex/codexIcons';

export function AgentHistory({
  agent,
  name,
  onOpenRun,
}: {
  agent: Agent;
  name: string;
  onOpenRun: () => void;
}) {
  return (
    <section className="codex-history px-1 pb-1" aria-label={`${name} activity`}>
      {agent.steps.length ? (
        <ol className="codex-steps m-0 list-none p-0">
          {agent.steps.map((step) => {
            const Icon =
              step.outcome === 'failed' || step.outcome === 'stopped'
                ? X
                : codexIcons[step.activity];
            return (
              <li key={step.id} data-outcome={step.outcome}>
                <details>
                  <summary
                    title={step.detail}
                    className="flex cursor-pointer items-center gap-2 py-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
                  >
                    <Icon
                      size={14}
                      aria-hidden
                      className={step.outcome === 'failed' ? 'text-error-foreground' : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate">{step.label}</span>
                    <time className="shrink-0 text-[length:var(--text-xs)] tabular-nums">
                      {step.endedAt
                        ? `${Math.max(0, (step.endedAt - step.startedAt) / 1000).toFixed(1)}s`
                        : '…'}
                    </time>
                  </summary>
                  {step.detail && (
                    <pre className="mt-1 mb-2 max-h-30 overflow-auto font-mono text-[length:var(--text-xs)] leading-[1.5] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                      {step.detail}
                    </pre>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground">Waiting for the next {name} action.</p>
      )}
      {!!agent.files?.length && (
        <div className="codex-changed-files mt-3 text-muted-foreground">
          <p className="mt-0 mb-1.5 text-[length:var(--text-xs)]">
            Changed files · {agent.files.length}
          </p>
          <ul className="m-0 max-h-30 list-none overflow-auto p-0">
            {agent.files.map((file) => (
              <li key={file} title={file} className="truncate py-0.5">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
      <footer className="flex justify-end pt-3">
        <button
          className="codex-open-run flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onOpenRun}
        >
          Open run <ArrowUpRight size={14} aria-hidden />
        </button>
      </footer>
    </section>
  );
}
