import { useEffect, useState } from 'react';
import { repositoryConnection, type RepositoryRemotes, type Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';

export function RepositoryRemotePicker({
  session,
  repositoryId,
}: {
  session: Session;
  repositoryId?: string;
}) {
  const project = useApp((app) => app.projects.find((project) => project.id === session.projectId));
  const path =
    useApp(
      (app) =>
        app.repositories[session.id]?.find((repository) => repository.id === repositoryId)?.path,
    ) ?? '';
  const { remote: selected, binding } = repositoryConnection(project, path);
  const legacy = !!binding;
  const [remotes, setRemotes] = useState<RepositoryRemotes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void desktop
      .call('pr.remotes', { sessionId: session.id, repositoryId })
      .then((result) => {
        if (!cancelled) setRemotes(result);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, repositoryId, selected]);
  if (!remotes || (remotes.names.length < 2 && remotes.selected && !legacy))
    return error ? <p role="alert">{error}</p> : null;
  if (!remotes.names.length)
    return (
      <p className="field-hint">
        Add a Git remote to this repository to load requests or push a branch.
      </p>
    );
  return (
    <div className="repository-remote-picker">
      <label>
        Git remote
        <select
          aria-label="Git remote"
          disabled={busy}
          value={remotes.selected ?? ''}
          onChange={async (event) => {
            setBusy(true);
            setError('');
            try {
              const project = await desktop.call('project.remote', {
                sessionId: session.id,
                repositoryId,
                remote: event.target.value || null,
              });
              useApp.setState((app) => ({
                projects: app.projects.map((entry) => (entry.id === project.id ? project : entry)),
              }));
              await useApp.getState().refreshGit(session.id);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="">{remotes.selected ? 'Automatic' : 'Choose a remote'}</option>
          {remotes.names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
