import { useEffect, useState } from 'react';
import type { GoInstallProgress, GoPackageStatus } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';

const packageSource = {
  managed: '',
  external: 'Installed outside Superfluid',
  missing: 'Not installed',
};

const installStage = {
  'downloading-go': 'Downloading Go…',
  'unpacking-go': 'Verifying and unpacking Go…',
  'installing-gopls': 'Installing gopls…',
};

export function LanguageSettings() {
  const [status, setStatus] = useState<GoPackageStatus>();
  const [progress, setProgress] = useState<GoInstallProgress>();
  const [error, setError] = useState('');
  const [requested, setRequested] = useState<GoPackageStatus['operation']>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    let progressRevision = 0;
    const refresh = () => {
      const id = ++request;
      const revision = progressRevision;
      void desktop.call('go.packageStatus', {}).then(
        (value) => {
          if (active && id === request) {
            setStatus(value);
            if (revision === progressRevision) setProgress(value.progress);
            setRequested(null);
            setError('');
          }
        },
        (failure: Error) => {
          if (active && id === request) setError(failure.message);
        },
      );
    };
    const unsubscribe = desktop.onEvent((event) => {
      if (event.type === 'go.package') refresh();
      else if (event.type === 'go.package.progress') {
        progressRevision++;
        setProgress(event.progress);
      }
    });
    window.addEventListener('focus', refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const operation = status?.operation ?? requested;
  const percent = progress?.stage === 'downloading-go' ? progress.percent : undefined;
  const message =
    operation === 'installing'
      ? progress
        ? installStage[progress.stage]
        : 'Preparing installation…'
      : operation === 'removing'
        ? 'Removing gopls from Superfluid…'
        : status
          ? packageSource[status.source]
          : !error && 'Checking for gopls…';
  const manage = (method: 'go.install' | 'go.remove') => {
    setRequested(method === 'go.install' ? 'installing' : 'removing');
    setError('');
    void desktop.call(method, {}).catch((failure: Error) => {
      setRequested(null);
      setError(failure.message);
    });
  };
  return (
    <>
      <h1 className="mt-0 mb-6 text-2xl leading-8 font-semibold tracking-[-0.6px]">Languages</h1>
      <div className="divide-y divide-border rounded-xl border border-border">
        <section aria-labelledby="python-language" className="px-4 py-4">
          <h2 id="python-language" className="m-0 text-sm leading-5 font-semibold">
            Python
          </h2>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">Built in</p>
        </section>
        <section aria-labelledby="go-language" className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="go-language" className="m-0 text-sm leading-5 font-semibold">
                Go
              </h2>
              <p className="mt-1 mb-0 text-sm text-muted-foreground">
                gopls adds completions, diagnostics, and code navigation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!operation && status?.source === 'managed' && (
                <button type="button" className="button" onClick={() => manage('go.remove')}>
                  Remove gopls
                </button>
              )}
              {!operation && status && (!status.goAvailable || status.source === 'missing') && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => manage('go.install')}
                >
                  {status.goAvailable ? 'Install gopls' : 'Download Go'}
                </button>
              )}
            </div>
          </div>
          {message && (
            <div className="mt-3 flex justify-between gap-3 text-sm text-muted-foreground">
              <span role="status">{message}</span>
              {operation === 'installing' && percent !== undefined && (
                <span className="tabular-nums" aria-hidden="true">
                  {percent}%
                </span>
              )}
            </div>
          )}
          {operation === 'installing' && (
            <>
              <progress
                aria-label="Go support installation"
                className="mt-2 block h-2 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&:indeterminate::-webkit-progress-value]:hidden [&:indeterminate::-webkit-progress-bar]:bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_5px,var(--border)_5px,var(--border)_10px)]"
                max={100}
                value={percent}
              />
              <p className="mt-2 mb-0 text-sm text-muted-foreground">
                You can close Settings. Installation will continue in the background.
              </p>
            </>
          )}
          {!operation && status && !status.goAvailable && (
            <p className="mt-2 mb-0 text-sm text-muted-foreground">
              Superfluid will install the Go toolchain and gopls together.
            </p>
          )}
          {(error || (!operation && status?.error)) && (
            <p
              role="alert"
              className="mt-3 mb-0 text-sm wrap-anywhere whitespace-pre-wrap text-destructive"
            >
              {error || status?.error}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
