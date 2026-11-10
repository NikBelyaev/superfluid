import { useId } from 'react';
import { ArrowRight, PencilLine } from 'lucide-react';
import type { Agent } from '@superfluid/contracts';
import { useApp, type AgentQuestionAnswer } from '~/state/workspaceStore';
import type { AgentCard } from './agentPriority';

export function AgentQuestionForm({
  card,
  question,
  onSubmit,
  onSkip,
}: {
  card: AgentCard;
  question: NonNullable<Agent['question']>;
  onSubmit: (send: () => Promise<void>) => void;
  onSkip: () => void;
}) {
  const id = useId();
  const draft = useApp((app) => app.agentQuestionDrafts[card.key]);
  const answers = draft?.id === question.id ? draft.answers : [];
  const values = question.questions.map((q, i) => {
    const answer = answers[i];
    return answer && 'option' in answer ? (q.options?.[answer.option] ?? '') : (answer?.text ?? '');
  });
  const reply =
    question.questions.length === 1
      ? (values[0] ?? '').trim()
      : question.questions.map((q, i) => `${q.title}\n${values[i].trim()}`).join('\n\n');
  const complete =
    question.questions.length > 0 && values.every((value) => value.trim()) && reply.length <= 16000;
  const change = (index: number, value: AgentQuestionAnswer) =>
    useApp.setState((app) => {
      const current = app.agentQuestionDrafts[card.key];
      const next = current?.id === question.id ? [...current.answers] : [];
      next[index] = value;
      return {
        agentQuestionDrafts: {
          ...app.agentQuestionDrafts,
          [card.key]: { id: question.id, answers: next },
        },
      };
    });
  return (
    <section
      aria-label="Request details"
      className="max-h-[min(360px,45vh)] overflow-auto px-1 pt-2 pb-1 focus-visible:outline-none"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete) return;
          onSubmit(async () => {
            await card.onQueue(reply);
            useApp.setState((app) => {
              if (app.agentQuestionDrafts[card.key] !== draft) return app;
              const next = { ...app.agentQuestionDrafts };
              delete next[card.key];
              return { agentQuestionDrafts: next };
            });
          });
        }}
      >
        {question.questions.map((q, index) => {
          const answer = answers[index];
          const selected = answer && 'option' in answer ? answer.option : undefined;
          return (
            <fieldset key={index} className="m-0 mb-2 min-w-0 border-0 p-0">
              <legend className="mb-2 w-full px-2 leading-[1.5] text-foreground [overflow-wrap:anywhere]">
                {q.title}
              </legend>
              {q.options?.map((option, choice) => (
                <label
                  key={choice}
                  className="group/choice flex cursor-pointer items-start gap-2 rounded-[10px] px-2 py-1.5 leading-[1.5] text-foreground hover:bg-foreground/6 has-checked:bg-foreground/6 has-focus-visible:bg-foreground/6"
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${id}-${index}`}
                    value={option}
                    checked={selected === choice}
                    onChange={() => change(index, { option: choice })}
                  />
                  <span
                    aria-hidden
                    className="mt-px grid size-4.5 shrink-0 place-items-center rounded-[4px] border border-solid border-border bg-foreground/4 text-[length:var(--text-xs)] text-muted-foreground tabular-nums"
                  >
                    {choice + 1}
                  </span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option}</span>
                  <ArrowRight
                    size={14}
                    aria-hidden
                    className={`mt-0.5 shrink-0 text-muted-foreground group-hover/choice:opacity-100 group-focus-within/choice:opacity-100 ${selected === choice ? 'opacity-100' : 'opacity-0'}`}
                  />
                </label>
              ))}
              <div className="mt-1 flex items-start gap-2 rounded-[10px] px-2 py-1.5 focus-within:bg-foreground/4">
                <PencilLine size={14} aria-hidden className="mt-0.5 text-muted-foreground" />
                <textarea
                  aria-label={
                    question.questions.length === 1
                      ? `Answer ${card.name}`
                      : `Answer ${card.name}: ${q.title}`
                  }
                  placeholder="Or write your own answer…"
                  rows={1}
                  required={selected === undefined}
                  maxLength={16000}
                  value={answer && 'text' in answer ? answer.text : ''}
                  onChange={(event) => change(index, { text: event.target.value })}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey) &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="min-h-5 max-h-24 w-full resize-none overflow-auto border-0 bg-transparent p-0 leading-[1.5] text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground focus-visible:outline-none"
                />
              </div>
            </fieldset>
          );
        })}
        {reply.length > 16000 && (
          <p role="alert" className="px-2 text-error-foreground">
            Answers must fit within 16,000 characters.
          </p>
        )}
        <footer className="flex justify-end gap-1 px-1 pt-1">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-full border border-solid border-border px-3 py-1 text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
          <button
            type="submit"
            aria-label={`Send to ${card.name}`}
            title={`Add to ${card.name} queue`}
            disabled={!complete}
            className="rounded-full bg-foreground px-3 py-1 text-background disabled:opacity-40"
          >
            Send
          </button>
        </footer>
      </form>
    </section>
  );
}
