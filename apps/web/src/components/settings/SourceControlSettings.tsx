import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { SourceControlDiscovery, SourceControlRepository } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { Skeleton } from '~/components/ui/Skeleton';
import { SourceControlToolRow } from './SourceControlToolRow';
import type { ConnectionCheck } from './SourceControlSetup';

export function SourceControlSettings() {
  const sessionId = useApp((app) => app.sessionId);
  const repositoryId = useApp((app) =>
    sessionId ? app.views[sessionId]?.repositoryIds?.[0] : undefined,
  );
  const project = useApp((app) => app.projects.find((project) => project.id === app.projectId));
  return (
    <SourceControlMachine
      key={JSON.stringify([
        sessionId,
        repositoryId,
        project?.gitRemote,
        project?.gitRemotes,
        project?.hosting,
      ])}
      sessionId={sessionId}
      repositoryId={repositoryId}
    />
  );
}

function SourceControlMachine({
  sessionId,
  repositoryId,
}: {
  sessionId: string | null;
  repositoryId?: string;
}) {
  const [result, setResult] = useState<SourceControlDiscovery | null>(null),
    [repository, setRepository] = useState<SourceControlRepository | null>(null),
    [checks, setChecks] = useState<Record<string, ConnectionCheck>>({}),
    [checkRequest, setCheckRequest] = useState<{ kind: 'github' | 'gitlab'; host: string } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [pending, setPending] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    setError('');
    setChecks({});
    const inspect = async () => {
      const [discovery, remote] = await Promise.all([
        desktop.call('sourceControl.discovery', {}),
        sessionId
          ? desktop.call('sourceControl.repository', { sessionId, repositoryId }).then(
              (value) => ({ value, error: '' }),
              (error: Error) => ({ value: null, error: error.message }),
            )
          : Promise.resolve({ value: null, error: '' }),
      ]);
      if (cancelled) return;
      const candidates = discovery.sourceControlProviders.filter((tool) =>
        tool.accounts.some((account) => account.host === remote.value?.host),
      );
      const repository = remote.value
        ? {
            ...remote.value,
            provider:
              remote.value.provider ??
              (candidates.length === 1 && candidates[0].kind !== 'git' ? candidates[0].kind : null),
          }
        : null;
      setResult(discovery);
      setRepository(repository);
      setError(remote.error);
      if (!checkRequest) return;
      const tool = discovery.sourceControlProviders.find((tool) => tool.kind === checkRequest.kind);
      let check: ConnectionCheck;
      if (!tool || tool.status !== 'available')
        check = { message: tool?.detail ?? 'CLI not found.', failed: true };
      else if (remote.error) check = { message: remote.error, failed: true };
      else if (
        sessionId &&
        repository?.host === checkRequest.host &&
        (!repository.provider || repository.provider === checkRequest.kind)
      ) {
        try {
          const context = await desktop.call('pr.context', { sessionId, repositoryId });
          if (context.host !== checkRequest.host || context.provider !== checkRequest.kind)
            throw new Error('The repository connection changed. Check again.');
          check = {
            message: `Connected to ${context.host}. Project ${context.sourceProject} is accessible.`,
            failed: false,
          };
        } catch (error) {
          check = { message: error instanceof Error ? error.message : String(error), failed: true };
        }
      } else {
        const authenticated = tool.accounts.some(
          (account) =>
            account.host === checkRequest.host && account.active && account.authenticated,
        );
        check = authenticated
          ? {
              message: `CLI available and signed in to ${checkRequest.host}. Open a repository on this server to verify project access.`,
              failed: false,
            }
          : {
              message: `No active login for ${checkRequest.host}. Run ${tool.executable} auth login, then check again.`,
              failed: true,
            };
      }
      if (!cancelled) setChecks({ [`${checkRequest.kind}:${checkRequest.host}`]: check });
    };
    void inspect()
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, sessionId, repositoryId, checkRequest]);
  const rescan = () => {
    setCheckRequest(null);
    setRevision((value) => value + 1);
  };
  const scan = (
    <button
      type="button"
      className="icon-button"
      aria-label="Rescan Git and hosting integrations"
      title="Rescan Git and hosting integrations"
      disabled={pending}
      onClick={rescan}
    >
      <RefreshCw size={14} />
    </button>
  );
  return (
    <div className="source-control-settings">
      <h1>Source Control</h1>
      <p className="source-control-intro">
        Version control tools and hosting integrations available on this machine.
      </p>
      <section aria-labelledby="version-control-heading">
        <div className="source-control-section-heading">
          <h2 id="version-control-heading">Version Control</h2>
          {scan}
        </div>
        <div className="source-control-section">
          {!result && !pending ? (
            <p className="source-control-no-project">
              Could not inspect this machine. Use Rescan to try again.
            </p>
          ) : !result ? (
            <div role="status" aria-label="Scanning version control tools">
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            result.versionControlSystems.map((tool) => (
              <SourceControlToolRow key={tool.kind} tool={tool} />
            ))
          )}
        </div>
      </section>
      <section aria-labelledby="source-control-providers-heading">
        <div className="source-control-section-heading">
          <h2 id="source-control-providers-heading">Source control providers</h2>
        </div>
        <div className="source-control-section">
          {!result && !pending ? (
            <p className="source-control-no-project">
              Could not inspect this machine. Use Rescan to try again.
            </p>
          ) : !result ? (
            <div role="status" aria-label="Scanning source control providers">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            result.sourceControlProviders.map((tool) => (
              <SourceControlToolRow
                key={tool.kind}
                tool={tool}
                repository={repository}
                pending={pending}
                checks={checks}
                onCheck={(kind, host) => {
                  setCheckRequest({ kind, host });
                  setRevision((value) => value + 1);
                }}
              />
            ))
          )}
        </div>
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
