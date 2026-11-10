import { useState } from 'react';
import { Bot } from 'lucide-react';
import { connectT3, disconnectT3 } from '~/commands/agents/t3';
import { useApp } from '~/state/workspaceStore';

export function T3Settings() {
  const integration = useApp((app) => app.t3);
  const [pairingLink, setPairingLink] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <section
      className="mt-8 rounded-xl border border-solid border-border p-5"
      aria-labelledby="t3-integration-title"
    >
      <div className="flex items-center gap-3">
        <Bot size={22} aria-hidden />
        <div>
          <h2 className="m-0 text-[15px]" id="t3-integration-title">
            T3 Code
          </h2>
          <p className="m-0 mt-[3px] text-sm text-muted-foreground">
            {integration?.connected
              ? 'Receiving activity'
              : integration?.enabled
                ? 'Waiting for T3'
                : 'Not connected'}
          </p>
        </div>
        {integration?.enabled && (
          <button
            className="button ml-auto"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError('');
              try {
                await disconnectT3();
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error));
              } finally {
                setPending(false);
              }
            }}
          >
            Disconnect T3
          </button>
        )}
      </div>
      <p>
        Show activity, recent steps and approval requests from T3 Code on this computer. Send
        messages to an existing conversation.
      </p>
      {(!integration?.enabled || integration.error) && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError('');
            try {
              await connectT3(pairingLink);
              setPairingLink('');
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            } finally {
              setPending(false);
            }
          }}
        >
          <p>
            In T3, open <strong>Settings → Sharing &amp; access</strong> and create a pairing link
            with <strong>Standard</strong> permissions. Paste the complete link below.
          </p>
          <label className="field">
            T3 pairing link
            <input
              type="password"
              autoComplete="off"
              value={pairingLink}
              required
              maxLength={8192}
              disabled={pending}
              onChange={(event) => setPairingLink(event.target.value)}
            />
          </label>
          <button className="button" type="submit" disabled={pending || !pairingLink.trim()}>
            {pending ? 'Connecting…' : 'Connect T3'}
          </button>
        </form>
      )}
      {integration?.origin && (
        <p className="font-mono text-[length:var(--text-xs)] leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">
          {integration.origin}
        </p>
      )}
      {(error || integration?.error) && (
        <p className="form-error" role="alert">
          {error || integration?.error}
        </p>
      )}
    </section>
  );
}
