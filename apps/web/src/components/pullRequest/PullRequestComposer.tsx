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
        className="pr-composer-trigger"
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
          className="pr-composer-positioner"
        >
          <Popover.Popup className="pr-composer" initialFocus={textarea}>
            <div className="pr-composer-heading">
              <Popover.Title>Comment on {term}</Popover.Title>
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
              <div className="pr-composer-actions">
                <span className="muted">⌘ / Ctrl + Enter to post</span>
                <button className="button" disabled={busy || !body.trim()}>
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
