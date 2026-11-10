import { memo } from 'react';
import type { Agent } from '@superfluid/contracts';
import { MarkdownText } from '~/components/ui/MarkdownText';

export const AgentResponse = memo(function AgentResponse({
  agent,
  name,
  request,
  onOpenRun,
}: {
  agent: Agent;
  name: string;
  request: boolean;
  onOpenRun: () => void;
}) {
  const text = request ? agent.approval?.reason : agent.message;
  return (
    <section
      aria-label={request ? 'Request details' : 'Agent response'}
      className="max-h-[220px] overflow-auto px-2 pt-2 pb-2.5 leading-[1.5] [overflow-wrap:anywhere]"
    >
      <div className="mb-2 text-[length:var(--text-xs)] text-muted-foreground">
        {agent.title || agent.model || name}
      </div>
      {text ? (
        <MarkdownText text={text} className="text-[length:var(--text-sm)]" />
      ) : (
        !request && (
          <p className="m-0 text-muted-foreground">No message was included in this run.</p>
        )
      )}
      {request && agent.approval?.detail && (
        <pre className="mt-2.5 mb-0 rounded-[10px] bg-foreground/6 p-2.5 font-mono text-[length:var(--text-xs)] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {agent.approval.detail}
        </pre>
      )}
      {!text && !agent.approval?.detail && (
        <button className="mt-2 text-muted-foreground hover:text-foreground" onClick={onOpenRun}>
          Open run ↗
        </button>
      )}
    </section>
  );
});
