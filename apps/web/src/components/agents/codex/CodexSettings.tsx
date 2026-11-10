import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { desktop } from '~/rpc/desktop';
import { configureCodex } from '~/commands/agents/codex';
import { useApp } from '~/state/workspaceStore';
import { CodexIcon } from './CodexIcon';

export function CodexSettings() {
  const integration = useApp((app) => app.codex);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void desktop
      .call('codex.status', {})
      .then((codex) => {
        if (!cancelled) useApp.setState({ codex });
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const configure = async () => {
    setPending(true);
    setError('');
    try {
      await configureCodex(!integration?.enabled);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="mt-8 rounded-xl border border-solid border-border p-5"
      aria-labelledby="codex-integration-title"
    >
      <div className="flex items-center gap-3">
        <CodexIcon size={22} />
        <div>
          <h2 className="m-0 text-[15px]" id="codex-integration-title">
            Codex
          </h2>
          <p className="m-0 mt-[3px] text-sm text-muted-foreground">
            {integration?.enabled ? 'Connected through Codex hooks' : 'Not connected'}
          </p>
        </div>
        <button
          className="button ml-auto"
          disabled={pending || !integration}
          onClick={() => void configure()}
        >
          {pending ? 'Updating…' : integration?.enabled ? 'Disconnect Codex' : 'Connect Codex'}
        </button>
      </div>
      <p>Show activity and approval requests from Codex sessions in your worktrees.</p>
      {integration?.enabled && (
        <div className="flex gap-2 rounded-lg bg-muted p-3">
          <Check size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p className="m-0">
            Review and trust the Superfluid hooks in Codex Settings → Hooks or with
            <code> /hooks</code> in the CLI. Start a new turn to show activity here.
          </p>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Open Codex as usual. To send messages from Superfluid, install Codex CLI. Disconnecting
        removes only Superfluid hooks and leaves Codex running.
      </p>
      {integration && (
        <p className="font-mono text-[length:var(--text-xs)] leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">
          {integration.configPath}
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
