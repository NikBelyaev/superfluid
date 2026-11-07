import { useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import type { SourceControlTool, SourceControlRepository } from '@superfluid/contracts';
import { SourceControlIcon } from './SourceControlIcons';
import { SourceControlSetup, type ConnectionCheck } from './SourceControlSetup';

export function SourceControlToolRow({
  tool,
  repository = null,
  pending = false,
  checks = {},
  onCheck,
}: {
  tool: SourceControlTool;
  repository?: SourceControlRepository | null;
  pending?: boolean;
  checks?: Record<string, ConnectionCheck>;
  onCheck?: (kind: 'github' | 'gitlab', host: string) => void;
}) {
  const auth =
    repository && (!repository.provider || repository.provider === tool.kind) && tool.kind !== 'git'
      ? tool.accounts.some(
          (account) => account.host === repository.host && account.active && account.authenticated,
        )
        ? 'authenticated'
        : 'unauthenticated'
      : tool.auth;
  const ready = tool.status === 'available' && (tool.kind === 'git' || auth === 'authenticated');
  const [expanded, setExpanded] = useState(tool.kind !== 'git' && !ready),
    [revealed, setRevealed] = useState(false);
  const status =
    tool.status === 'missing'
      ? 'Not installed'
      : tool.status === 'error' || auth === 'unknown'
        ? 'Needs attention'
        : auth === 'unauthenticated'
          ? 'Not authenticated'
          : auth === 'authenticated'
            ? 'Authenticated'
            : 'Available';
  const detailsId = `source-control-${tool.kind}-details`;
  return (
    <div className="source-control-tool">
      <div className="source-control-tool-row">
        <div className="source-control-tool-copy">
          <div className="source-control-tool-title">
            <span className={`source-control-tool-mark ${tool.kind}`}>
              <SourceControlIcon kind={tool.kind} />
            </span>
            <strong>{tool.label}</strong>
            {tool.version && <code>{tool.version}</code>}
            {tool.kind !== 'git' && (
              <span className={`source-control-badge ${ready ? 'ready' : 'warning'}`}>
                {status}
              </span>
            )}
          </div>
          <p>
            {tool.status === 'available' && auth !== tool.auth && repository
              ? `Sign in to ${repository.host} to connect this repository.`
              : tool.detail}
          </p>
        </div>
        <div className="source-control-tool-actions">
          {tool.kind !== 'git' && (
            <button
              type="button"
              className="icon-button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`Toggle ${tool.label} details`}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
            </button>
          )}
          <input
            type="checkbox"
            role="switch"
            className="source-control-availability"
            checked={ready}
            disabled
            aria-label={`${tool.label} availability`}
          />
        </div>
      </div>
      {expanded && (
        <div id={detailsId} className="source-control-tool-details">
          {tool.kind !== 'git' && (
            <>
              {tool.accounts.length > 0 && (
                <div className="source-control-account-heading">
                  <p>
                    Accounts use the active <code>{tool.executable}</code> login for each host.
                  </p>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${revealed ? 'Hide' : 'Reveal'} ${tool.label} accounts`}
                    aria-pressed={revealed}
                    onClick={() => setRevealed(!revealed)}
                  >
                    {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              )}
              {tool.accounts.length > 0 &&
                tool.accounts.map((account, index) => (
                  <div
                    className="source-control-account"
                    key={`${account.host}:${account.login ?? index}`}
                  >
                    <div>
                      <strong>{account.host}</strong>
                      <p>
                        {account.login ? (
                          <>
                            {account.authenticated ? 'Signed in as' : 'Login'}{' '}
                            <span className="source-control-login">
                              {revealed ? (
                                account.login
                              ) : (
                                <>
                                  <span aria-hidden>••••••••</span>
                                  <span className="sr-only">Hidden account</span>
                                </>
                              )}
                            </span>
                            {account.active && ' · Active CLI account'}
                          </>
                        ) : (
                          'No active login'
                        )}
                      </p>
                    </div>
                    <span
                      className={`source-control-status-dot ${account.authenticated ? 'ready' : ''}`}
                      role="img"
                      aria-label={account.authenticated ? 'Authenticated' : 'Authentication failed'}
                    />
                  </div>
                ))}
              {onCheck && (
                <SourceControlSetup
                  key={repository?.host}
                  tool={tool}
                  repository={repository}
                  pending={pending}
                  checks={checks}
                  onCheck={onCheck}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
