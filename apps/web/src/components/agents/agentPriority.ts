import type { ReactNode } from 'react';
import type { Agent } from '@superfluid/contracts';

export interface AgentCard {
  key: string;
  agent: Agent;
  name: string;
  icon: ReactNode;
  onRespond: (decision: 'allow' | 'deny') => Promise<void>;
  onOpenRun: () => Promise<void>;
  message: (onSubmit: (send: () => Promise<void>) => void) => ReactNode;
  onQueue: (message: string) => Promise<void>;
  onDismiss: () => void;
}

export type AgentDetail = {
  key: string;
  run: string;
  mode: 'history' | 'response' | 'request' | 'message';
  returnTo?: 'response' | 'request';
};

export const finished = (agent: Agent) => ['done', 'stopped', 'failed'].includes(agent.status);
export const runKey = ({ key, agent }: AgentCard) => `${key}:${agent.runId ?? agent.startedAt}`;
export const requestKey = (card: AgentCard) =>
  `${runKey(card)}:${card.agent.approval?.id ?? card.agent.question?.id ?? 'request'}`;
export const attentionKey = (cards: AgentCard[]) =>
  cards
    .filter((card) => card.agent.status === 'needs-input' || finished(card.agent))
    .map((card) => (card.agent.status === 'needs-input' ? requestKey(card) : runKey(card)))
    .sort()
    .join('|');

export function validDetail(cards: AgentCard[], detail: AgentDetail | null) {
  const card = cards.find((card) => card.key === detail?.key && runKey(card) === detail.run);
  if (!card || !detail) return null;
  if (detail.mode === 'history' && card.agent.status !== 'working') return null;
  if (detail.mode === 'request' && card.agent.status !== 'needs-input') return null;
  if (detail.mode === 'response' && !finished(card.agent)) return null;
  if (
    detail.mode === 'message' &&
    !finished(card.agent) &&
    !(card.agent.status === 'needs-input' && card.agent.question)
  )
    return null;
  return detail;
}

export function pickAgent(
  cards: AgentCard[],
  state: {
    selected: string | null;
    focus: { key: string; attention: string } | null;
    detail: AgentDetail | null;
    skipped: string[];
    seen: string[];
  },
) {
  const detail = validDetail(cards, state.detail);
  const focus = state.focus?.attention === attentionKey(cards) ? state.focus.key : null;
  const chosen = cards.find((card) => card.key === (detail?.key ?? focus));
  if (chosen) return chosen;
  const request = cards
    .filter(
      (card) => card.agent.status === 'needs-input' && !state.skipped.includes(requestKey(card)),
    )
    .sort(
      (a, b) =>
        (a.agent.approval?.startedAt ?? a.agent.updatedAt) -
        (b.agent.approval?.startedAt ?? b.agent.updatedAt),
    )[0];
  if (request) return request;
  const completion = cards
    .filter((card) => finished(card.agent) && !state.seen.includes(runKey(card)))
    .sort((a, b) => a.agent.updatedAt - b.agent.updatedAt)[0];
  if (completion) return completion;
  const preferred = cards.find((card) => card.key === state.selected);
  return (
    (preferred?.agent.status === 'working' ? preferred : undefined) ??
    cards.find((card) => card.agent.status === 'working') ??
    (preferred?.agent.status === 'queued' ? preferred : undefined) ??
    cards.find((card) => card.agent.status === 'queued') ??
    (preferred && finished(preferred.agent) ? preferred : undefined) ??
    cards.find((card) => finished(card.agent)) ??
    preferred ??
    cards[0]
  );
}
