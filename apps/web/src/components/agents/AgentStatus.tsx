import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { openCodexRun, respondToCodex, queueCodexMessage } from '~/commands/agents/codex';
import { openT3Run, respondToT3, queueT3Message } from '~/commands/agents/t3';
import { CodexIcon } from './codex/CodexIcon';
import { AgentMessageForm } from './AgentMessageForm';
// T3 Code brand asset (MIT); see LICENSES/T3-Code.txt.
import t3Icon from './t3/t3-icon.png';
import { AgentDeck } from './AgentDeck';
import type { AgentCard } from './agentPriority';

export function AgentStatus({ session }: { session: Session }) {
  const codex = useApp((app) => app.codex?.enabled);
  const t3 = useApp((app) => app.t3?.connected);
  const codexAgents = useApp((app) => app.codexAgents);
  const t3Agents = useApp((app) => app.t3Agents);
  const codexDismissed = useApp((app) => app.codexDismissed);
  const t3Dismissed = useApp((app) => app.t3Dismissed);
  const cards: AgentCard[] = [];
  if (codex)
    for (const agent of codexAgents) {
      const token = `${agent.id}:${agent.runId ?? agent.startedAt}`;
      if (
        agent.sessionId !== session.id ||
        agent.status === 'idle' ||
        codexDismissed.includes(token)
      )
        continue;
      const queue = async (message: string) => {
        await queueCodexMessage({ sessionId: session.id, agentId: agent.id, message });
      };
      cards.push({
        key: 'codex:' + agent.id,
        agent,
        name: 'Codex',
        icon: <CodexIcon />,
        onQueue: queue,
        onOpenRun: () => openCodexRun(agent.threadId),
        onRespond: (decision) =>
          respondToCodex({
            sessionId: session.id,
            agentId: agent.id,
            requestId: agent.approval!.id,
            decision,
          }),
        message: (onSubmit) => (
          <AgentMessageForm
            name="Codex"
            drafts="codexDrafts"
            agentId={agent.id}
            onSend={queue}
            onSubmit={onSubmit}
          />
        ),
        onDismiss: () =>
          useApp.setState((app) => ({
            codexDismissed: [...app.codexDismissed, token].slice(-128),
          })),
      });
    }
  if (t3)
    for (const agent of t3Agents) {
      const token = `${agent.id}:${agent.runId ?? agent.startedAt}`;
      if (agent.sessionId !== session.id || agent.status === 'idle' || t3Dismissed.includes(token))
        continue;
      const queue = async (message: string) => {
        await queueT3Message({ sessionId: session.id, agentId: agent.id, message });
      };
      cards.push({
        key: 't3:' + agent.id,
        agent,
        name: 'T3',
        icon: (
          <img
            src={t3Icon}
            width={16}
            height={16}
            alt=""
            aria-hidden
            draggable={false}
            data-provider="t3"
          />
        ),
        onQueue: queue,
        onOpenRun: () => openT3Run(agent.url),
        onRespond: (decision) =>
          respondToT3({
            sessionId: session.id,
            agentId: agent.id,
            requestId: agent.approval!.id,
            decision,
          }),
        message: (onSubmit) => (
          <AgentMessageForm
            name="T3"
            drafts="t3Drafts"
            agentId={agent.id}
            onSend={queue}
            onSubmit={onSubmit}
          />
        ),
        onDismiss: () =>
          useApp.setState((app) => ({ t3Dismissed: [...app.t3Dismissed, token].slice(-128) })),
      });
    }
  cards.sort((a, b) => a.agent.startedAt - b.agent.startedAt || a.key.localeCompare(b.key));
  return <AgentDeck cards={cards} />;
}
