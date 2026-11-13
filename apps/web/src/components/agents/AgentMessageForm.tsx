import { ArrowUp } from 'lucide-react';
import { MessageComposer, MessageComposerSend } from '~/components/ui/MessageComposer';
import { useApp } from '~/state/workspaceStore';
export function AgentMessageForm({
  name,
  drafts,
  agentId,
  onSend,
  onSubmit,
}: {
  name: string;
  drafts: 'codexDrafts' | 't3Drafts';
  agentId: string;
  onSend: (message: string) => Promise<void>;
  onSubmit: (send: () => Promise<void>) => void;
}) {
  const message = useApp((app) => app[drafts][agentId] ?? '');
  return (
    <form
      className="codex-message"
      onSubmit={(event) => {
        event.preventDefault();
        if (!message.trim()) return;
        const submitted = message;
        onSubmit(async () => {
          await onSend(submitted);
          useApp.setState((app) => ({
            [drafts]: {
              ...app[drafts],
              [agentId]: app[drafts][agentId] === submitted ? '' : (app[drafts][agentId] ?? ''),
            },
          }));
        });
      }}
    >
      <MessageComposer
        variant="embedded-dark"
        input={{
          'aria-label': `Message ${name}`,
          placeholder: `Message ${name}…`,
          autoFocus: true,
          required: true,
          rows: 3,
          maxLength: 16000,
          value: message,
          onChange: (event) => {
            const value = event.target.value;
            useApp.setState((app) => ({ [drafts]: { ...app[drafts], [agentId]: value } }));
          },
          onKeyDown: (event) => {
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          },
        }}
        action={
          <MessageComposerSend
            type="submit"
            aria-label={`Send to ${name}`}
            disabled={!message.trim()}
            title={`Add to ${name} queue`}
          >
            <ArrowUp size={16} />
          </MessageComposerSend>
        }
      />
    </form>
  );
}
