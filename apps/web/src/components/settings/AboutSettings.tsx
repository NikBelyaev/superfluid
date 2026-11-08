import { RELEASE_REPOSITORY, updateChannel } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { updateApp } from '~/commands/updateApp';
import { useUpdates } from '~/state/updates';
import { useApp } from '~/state/workspaceStore';

export function AboutSettings() {
  const state = useUpdates((s) => s.state);
  const pending = !state || ['checking', 'downloading', 'installing'].includes(state.status);
  return (
    <>
      <h1 className="mt-0 mb-2 text-2xl font-semibold">About Superfluid</h1>
      <p className="text-muted-foreground">Version {state?.version ?? '…'}</p>
      <section className="mt-8" aria-labelledby="update-track-heading">
        <h2 id="update-track-heading" className="text-base font-semibold">
          Updates
        </h2>
        <label className="flex items-center gap-4">
          Update track
          <select
            className="rounded-md border border-input bg-background px-3 py-2"
            aria-label="Update track"
            value={state?.channel ?? 'stable'}
            disabled={pending}
            onChange={(event) =>
              void updateApp({
                action: 'channel',
                channel: updateChannel.parse(event.target.value),
              })
            }
          >
            <option value="stable">Stable</option>
            <option value="nightly">Nightly</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          Nightly includes the latest changes and may be less reliable. Switching tracks keeps your
          projects and drafts.
        </p>
        <p role={state?.status === 'error' ? 'alert' : 'status'}>
          {state?.status === 'checking'
            ? 'Checking for updates…'
            : state?.status === 'downloading'
              ? `Downloading… ${state.progress ?? 0}%`
              : state?.status === 'installing'
                ? 'Saving your work and restarting…'
                : state?.message ||
                  (state?.availableVersion
                    ? `${state.availableVersion} ${state.status === 'downloaded' ? 'is ready to install.' : 'is available.'}`
                    : '')}
        </p>
        {state?.status === 'downloading' && (
          <progress aria-label="Update download" value={state.progress ?? 0} max={100} />
        )}
        <div className="flex flex-wrap gap-2">
          {state?.status === 'available' ? (
            <button
              className="button primary"
              onClick={() => void updateApp({ action: 'download' })}
            >
              Download update
            </button>
          ) : state?.status === 'downloaded' ? (
            <button
              className="button primary"
              onClick={() => void updateApp({ action: 'install' })}
            >
              Restart and install
            </button>
          ) : (
            <button
              className="button"
              disabled={pending || state?.status === 'disabled'}
              onClick={() => void updateApp({ action: 'check' })}
            >
              {state?.status === 'error' ? 'Retry update check' : 'Check for updates'}
            </button>
          )}
          <button
            className="button"
            onClick={() =>
              void desktop
                .external(
                  `https://github.com/${RELEASE_REPOSITORY}/releases${state?.availableVersion ? `/tag/v${state.availableVersion}` : ''}`,
                )
                .catch(useApp.getState().fail)
            }
          >
            Release notes
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Installation restarts Superfluid and stops processes in every worktree. Unsaved edits are
          kept in recovery.
        </p>
        {state?.releaseNotes && (
          <pre className="mt-6 whitespace-pre-wrap break-words font-sans text-sm">
            {state.releaseNotes}
          </pre>
        )}
      </section>
    </>
  );
}
