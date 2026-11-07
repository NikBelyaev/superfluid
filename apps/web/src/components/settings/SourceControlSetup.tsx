import { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import type { SourceControlRepository, SourceControlTool } from '@superfluid/contracts';
import { InstallSnippet, LoginSnippet } from './InstallSnippet';
import { SourceControlPermissions } from './SourceControlPermissions';
import './sourceControlSetup.css';

export interface ConnectionCheck {
  message: string;
  failed: boolean;
}

export function SourceControlSetup({
  tool,
  repository,
  pending,
  checks,
  onCheck,
}: {
  tool: SourceControlTool;
  repository: SourceControlRepository | null;
  pending: boolean;
  checks: Record<string, ConnectionCheck>;
  onCheck: (kind: 'github' | 'gitlab', host: string) => void;
}) {
  const [browser, setBrowser] = useState(true);
  const provider = tool.kind === 'github' ? 'github' : 'gitlab';
  const cli = provider === 'github' ? 'gh' : 'glab';
  const target =
    repository && (!repository.provider || repository.provider === provider) ? repository : null;
  const host =
    target?.host ?? tool.accounts.find((account) => account.active)?.host ?? `${provider}.com`;
  const check = checks[`${provider}:${host}`];
  const installed = tool.status === 'available';
  const authenticated =
    installed &&
    tool.accounts.some(
      (account) => account.host === host && account.active && account.authenticated,
    );
  const [expanded, setExpanded] = useState(!authenticated);
  const hostname = /^[\w.:[\]-]+$/.test(host) ? host : `'${host.replace(/'/g, "'\\''")}'`;
  const command = `${cli} auth login --hostname ${hostname}${provider === 'github' && browser ? ' --web' : ''}`;
  return (
    <details
      className="source-control-setup"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Connection instructions</summary>
      <div className="source-control-setup-repository">
        <code>{host}</code>
        <span>
          {target
            ? `from Git remote · ${target.project}`
            : tool.accounts.length
              ? 'from CLI configuration'
              : 'Default server; use your server hostname for self-hosted installations.'}
        </span>
      </div>
      <ol className="source-control-steps">
        <li className="source-control-step">
          <span
            className={`source-control-step-number ${installed ? 'done' : ''}`}
            aria-label={`Step 1${installed ? ', complete' : ''}`}
          >
            {installed ? <Check size={13} aria-hidden /> : '1'}
          </span>
          <div>
            <h3>Install {cli}</h3>
            <p className="source-control-step-hint">
              {installed
                ? `${cli} is installed on this machine.`
                : 'Run this command in your terminal.'}
            </p>
            {installed ? (
              <details className="source-control-installed">
                <summary>Install command</summary>
                <InstallSnippet cli={cli} />
              </details>
            ) : (
              <InstallSnippet cli={cli} />
            )}
          </div>
        </li>
        <li className="source-control-step">
          <span className="source-control-step-number" aria-label="Step 2">
            2
          </span>
          <div>
            <h3>{provider === 'gitlab' ? 'Prepare token permissions' : 'Allow access'}</h3>
            <SourceControlPermissions
              key={host}
              provider={provider}
              host={host}
              browser={browser}
              onBrowserChange={setBrowser}
            />
          </div>
        </li>
        <li className="source-control-step">
          <span className="source-control-step-number" aria-label="Step 3">
            3
          </span>
          <div>
            <h3>Sign in to {tool.label}</h3>
            <p className="source-control-step-hint">
              {provider === 'github' && browser
                ? 'Complete sign-in in the browser that opens.'
                : 'Choose token authentication and paste your PAT at the terminal prompt.'}
            </p>
            <LoginSnippet command={command} cli={cli} />
            <p className="source-control-setup-note">
              {provider === 'gitlab' || !browser
                ? 'Enter your token only in the CLI. Superfluid does not need you to paste it here.'
                : 'Uses the saved gh login. Git keeps using your SSH keys or credential helper.'}
            </p>
          </div>
        </li>
        <li className="source-control-step">
          <span className="source-control-step-number" aria-label="Step 4">
            4
          </span>
          <div>
            <div className="source-control-verification">
              <div>
                <h3>Check your connection</h3>
                <p className="source-control-step-hint">
                  Refresh CLI, sign-in and project access status.
                </p>
              </div>
              <button
                type="button"
                className="button primary"
                disabled={pending}
                onClick={() => onCheck(provider, host)}
              >
                <RefreshCw size={13} aria-hidden />
                {pending ? 'Checking…' : 'Check connection'}
              </button>
            </div>
            {check && (
              <p
                className={
                  check.failed
                    ? 'source-control-check-result error-text'
                    : 'source-control-check-result'
                }
                role={check.failed ? 'alert' : 'status'}
              >
                {check.message}
              </p>
            )}
          </div>
        </li>
      </ol>
    </details>
  );
}
