import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Agent } from '@superfluid/contracts';
import { AgentPill } from './AgentPill';
import {
  attentionKey,
  finished,
  pickAgent,
  requestKey,
  runKey,
  validDetail,
  type AgentCard,
  type AgentDetail,
} from './agentPriority';

export function AgentDeck({ cards }: { cards: AgentCard[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ key: string; attention: string } | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [closing, setClosing] = useState<Record<string, AgentCard>>({});
  const [queued, setQueued] = useState<Record<string, Agent | undefined>>({});
  const [answered, setAnswered] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const listId = useId();
  const projected = cards.map((card) => {
    const snapshot = queued[card.key];
    const optimisticQueue =
      snapshot &&
      snapshot.runId === card.agent.runId &&
      snapshot.startedAt === card.agent.startedAt &&
      snapshot.updatedAt === card.agent.updatedAt &&
      snapshot.status === card.agent.status;
    if (optimisticQueue) return { ...card, agent: { ...card.agent, status: 'queued' as const } };
    if (card.agent.approval && answered.includes(requestKey(card)))
      return { ...card, agent: { ...card.agent, approval: undefined, status: 'working' as const } };
    return card;
  });
  const available = projected.filter((card) => !closing[runKey(card)]);
  const visible = [
    ...projected,
    ...Object.values(closing).filter(
      (card) => !projected.some((current) => current.key === card.key),
    ),
  ];
  const open = validDetail(available, detail);
  const front = pickAgent(available, { selected, focus, detail: open, skipped, seen });
  const ordered = front ? [front, ...visible.filter((card) => card.key !== front.key)] : visible;
  const expanded = !open && (pinned || (hover && front?.agent.status !== 'needs-input'));
  const requests = available
    .filter((card) => card.agent.status === 'needs-input')
    .sort(
      (a, b) =>
        (a.agent.approval?.startedAt ?? a.agent.updatedAt) -
        (b.agent.approval?.startedAt ?? b.agent.updatedAt),
    );
  const order = ordered.map((card) => runKey(card)).join('|');

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      const items = node.querySelector<HTMLElement>('[data-deck-items]');
      if (!items) return;
      const elements = [
        ...items.querySelectorAll<HTMLElement>(':scope > [data-agent-card]:not([data-exiting])'),
      ];
      // Read geometry before writing offsets to avoid a synchronous layout for each card.
      const width = items.clientWidth || 280;
      const heights = elements.map((card) => card.offsetHeight);
      const height = heights[elements.findIndex((card) => card.hasAttribute('data-front'))] ?? 0;
      let offset = 0;
      elements.forEach((card, index) => {
        const depth = Math.min(index, 2);
        card.style.setProperty('--agent-open-y', offset + 'px');
        card.style.setProperty(
          '--agent-fold-y',
          (index ? Math.max(0, height - heights[index]) + depth * 8 : 0) + 'px',
        );
        card.style.setProperty('--agent-fold-scale', String(1 - (depth * 10) / width));
        offset += heights[index] + 8;
      });
      items.style.setProperty(
        '--agent-fold-height',
        height + Math.max(0, Math.min(elements.length - 1, 2)) * 8 + 'px',
      );
      items.style.setProperty(
        '--agent-open-height',
        Math.min(340, Math.max(height, offset - 8)) + 'px',
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    node.querySelectorAll('[data-agent-card]').forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [order, front?.key, closing]);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    node.querySelector('[data-agents]')?.setAttribute('aria-expanded', String(expanded));
    node.querySelector('[data-agents]')?.setAttribute('aria-controls', listId);
    if (!expanded) node.querySelector('[data-deck-items]')?.scrollTo({ top: 0 });
    if (restoreFocus.current) {
      node
        .querySelector<HTMLButtonElement>('[data-front] [data-agent-trigger]')
        ?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  });

  useLayoutEffect(() => {
    let cancelled = false;
    for (const token of Object.keys(closing)) {
      const node = [
        ...(root.current?.querySelectorAll<HTMLElement>('[data-agent-card]') ?? []),
      ].find((node) => node.dataset.run === token);
      if (node) void node.offsetHeight;
      const animations =
        node
          ?.getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getComputedTiming().iterations)) ?? [];
      void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
        if (cancelled) return;
        setClosing((current) => {
          const next = { ...current };
          delete next[token];
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [closing]);

  const close = () => {
    setDetail(null);
    setFocus(null);
    setPinned(false);
    setHover(false);
    restoreFocus.current = true;
  };
  const select = (
    card: AgentCard,
    mode: AgentDetail['mode'] | null,
    returnTo?: AgentDetail['returnTo'],
  ) => {
    setSelected(card.key);
    setFocus({ key: card.key, attention: attentionKey(available) });
    if (finished(card.agent))
      setSeen((current) => [...new Set([...current, runKey(card)])].slice(-256));
    setDetail(mode ? { key: card.key, run: runKey(card), mode, returnTo } : null);
    setPinned(false);
    setHover(false);
    if (mode !== 'message') restoreFocus.current = true;
  };
  const act = async (card: AgentCard, task: () => Promise<void>) => {
    if (pending.includes(runKey(card))) return;
    const token = runKey(card);
    setPending((current) => [...current, token]);
    setErrors((current) => ({ ...current, [token]: '' }));
    try {
      await task();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [token]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setPending((current) => current.filter((key) => key !== token));
    }
  };
  if (!visible.length) return null;
  return (
    <div
      ref={root}
      className="agent-deck group/deck relative w-full shrink-0"
      aria-label="Agents"
      data-expanded={expanded || undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && matchMedia('(hover:hover) and (pointer:fine)').matches)
          setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && (open || pinned || hover)) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div
        id={listId}
        data-deck-items
        className={`relative ${expanded ? 'h-[var(--agent-open-height,36px)] overflow-x-hidden overflow-y-auto' : 'h-[var(--agent-fold-height,36px)] overflow-visible'}`}
      >
        {ordered.map((card, index) => {
          const isFront = front?.key === card.key;
          const exiting = !!closing[runKey(card)];
          const deferred =
            card.agent.status === 'needs-input' && skipped.includes(requestKey(card));
          const handling =
            isFront &&
            card.agent.status === 'needs-input' &&
            (!deferred ||
              open?.key === card.key ||
              (focus?.key === card.key && focus.attention === attentionKey(available)));
          return (
            <div
              key={card.key}
              data-agent-card={card.key}
              data-run={runKey(card)}
              data-front={isFront || undefined}
              data-exiting={exiting || undefined}
              inert={exiting || (!isFront && !expanded)}
              aria-hidden={exiting || (!isFront && !expanded) || undefined}
              className={`absolute inset-x-0 top-0 origin-top transition-[translate,scale,opacity] duration-[260ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${expanded ? 'translate-y-[var(--agent-open-y,0px)] scale-x-100' : 'translate-y-[var(--agent-fold-y,0px)] scale-x-[var(--agent-fold-scale,1)]'} ${exiting || (!expanded && index >= 3) ? 'opacity-0' : 'opacity-100'} ${exiting ? 'pointer-events-none' : ''}`}
              style={{ zIndex: ordered.length - index }}
            >
              <AgentPill
                card={card}
                front={isFront}
                active={isFront || expanded || exiting}
                multiple={available.length > 1}
                mode={isFront ? (open?.mode ?? null) : null}
                deferred={deferred}
                handling={handling}
                position={`${requests.findIndex((item) => item.key === card.key) + 1}/${requests.length}`}
                pending={pending.includes(runKey(card))}
                error={errors[runKey(card)]}
                onAgents={() => {
                  setPinned(!!open || !pinned);
                  setDetail(null);
                  setHover(false);
                  restoreFocus.current = true;
                }}
                onTrigger={() => {
                  if (!isFront) {
                    select(
                      card,
                      finished(card.agent)
                        ? 'response'
                        : card.agent.status === 'needs-input'
                          ? 'request'
                          : null,
                    );
                    return;
                  }
                  const mode = finished(card.agent)
                    ? 'response'
                    : card.agent.status === 'working'
                      ? 'history'
                      : card.agent.status === 'needs-input'
                        ? 'request'
                        : null;
                  if (open?.mode === mode) close();
                  else select(card, mode);
                }}
                onMessage={() => {
                  if (card.agent.status === 'needs-input' && card.agent.question) {
                    if (isFront && open?.mode === 'request') close();
                    else select(card, 'request');
                    return;
                  }
                  if (isFront && open?.mode === 'message') {
                    if (open.returnTo) select(card, open.returnTo);
                    else close();
                  } else
                    select(
                      card,
                      'message',
                      isFront && (open?.mode === 'response' || open?.mode === 'request')
                        ? open.mode
                        : undefined,
                    );
                }}
                onLater={() => {
                  setSkipped((current) => [...new Set([...current, requestKey(card)])].slice(-256));
                  close();
                }}
                onDismiss={() => {
                  if (isFront) close();
                  setClosing((current) => ({ ...current, [runKey(card)]: card }));
                  card.onDismiss();
                }}
                onRespond={(decision) => {
                  close();
                  void act(card, async () => {
                    await card.onRespond(decision);
                    setAnswered((current) => [...current, requestKey(card)].slice(-256));
                  });
                }}
                onSubmit={(send) => {
                  if (pending.includes(runKey(card))) return;
                  setQueued((current) => ({ ...current, [card.key]: card.agent }));
                  close();
                  void act(card, async () => {
                    try {
                      await send();
                    } catch (error) {
                      setQueued((current) =>
                        current[card.key] === card.agent
                          ? { ...current, [card.key]: undefined }
                          : current,
                      );
                      setFocus(
                        (current) =>
                          current ?? { key: card.key, attention: attentionKey(available) },
                      );
                      throw error;
                    }
                  });
                }}
                onOpenRun={() => void act(card, card.onOpenRun)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
