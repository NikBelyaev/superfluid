// Adapted from T3 Code PullRequestComposer and PullRequestCommentForm (MIT).
import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { MessageSquare, Send, X } from 'lucide-react';
import type { PullRequestRef } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';

export function PullRequestComposer({
  sessionId,
  repositoryId,
  request,
  onCommented,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequestRef;
  onCommented: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const term = request.provider === 'gitlab' ? 'merge request' : 'pull request';
  const submit = async () => {
    if (!body.trim() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await desktop.call('pr.comment', { sessionId, repositoryId, ref: request, body });
      setBody('');
      setOpen(false);
      onCommented();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="pr-composer-trigger absolute right-4 bottom-3 z-2 flex size-9 items-center justify-center rounded-lg border border-solid border-border bg-card shadow-[var(--shadow-popover)] hover:bg-accent"
        aria-label={`Comment on ${term}`}
        title={`Comment on ${term}`}
      >
        <MessageSquare size={17} />
      </Popover.Trigger>
      <Popover.Portal keepMounted>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={8}
          className="pr-composer-positioner z-90"
        >
          <Popover.Popup
            className="pr-composer w-[min(420px,calc(100vw-32px))] max-h-[var(--available-height)] overflow-auto rounded-xl border border-solid border-border bg-popover p-4 shadow-[var(--shadow-popover)] outline-none"
            initialFocus={textarea}
          >
            <div className="pr-composer-heading mb-3 flex items-center justify-between gap-2">
              <Popover.Title className="m-0 text-xs leading-5 font-medium">
                Comment on {term}
              </Popover.Title>
              <Popover.Close className="icon-button" aria-label="Close composer">
                <X size={14} />
              </Popover.Close>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <textarea
                className="block min-h-24 w-full resize-y rounded-[var(--control-radius)] border border-solid border-input bg-background px-3 py-2 text-xs leading-5"
                ref={textarea}
                disabled={busy}
                value={body}
                rows={4}
                maxLength={65536}
                placeholder="Leave a comment"
                aria-label={`Comment on this ${term}`}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (
                    event.key === 'Enter' &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!event.repeat) void submit();
                  }
                }}
              />
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <div className="pr-composer-actions mt-2 flex flex-wrap items-center justify-between gap-2 text-[length:var(--text-2xs)]">
                <span className="muted">⌘ / Ctrl + Enter to post</span>
                <button
                  className="button h-7 px-2 text-xs leading-5"
                  disabled={busy || !body.trim()}
                >
                  <Send size={14} />
                  {busy ? 'Posting…' : 'Comment'}
                </button>
              </div>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
