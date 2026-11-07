import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { CopyButton } from '~/components/ui/CopyButton';
import { Tooltip } from '~/components/ui/Tooltip';
import { desktop } from '~/rpc/desktop';

const scopes = [
  ['repo', 'Read and write repositories, create and edit pull requests.'],
  ['read:org', 'Read organization and team membership.'],
  ['gist', 'Access gists; included in the standard gh permissions.'],
] as const;
const gitlabRights = [
  ['Project', 'Read'],
  ['Merge Request', 'Read · Create · Update'],
  ['Work Item', 'Create · comments'],
  ['Pipeline', 'Read'],
  ['Job', 'Read'],
];

export function SourceControlPermissions({
  provider,
  host,
  browser,
  onBrowserChange,
}: {
  provider: 'github' | 'gitlab';
  host: string;
  browser: boolean;
  onBrowserChange: (browser: boolean) => void;
}) {
  const [fine, setFine] = useState(true);
  const [https, setHttps] = useState(false);
  const [error, setError] = useState('');
  const github = provider === 'github';
  const rights = https ? [...gitlabRights, ['Code', 'Download · Push']] : gitlabRights;
  const tokenUrl = new URL(
    github ? '/settings/tokens/new' : '/-/user_settings/personal_access_tokens',
    `https://${host}`,
  );
  if (github) tokenUrl.searchParams.set('scopes', 'repo,read:org,gist');
  return (
    <>
      {!github && (
        <p className="source-control-step-hint">
          Create a PAT with access to the projects you need. For forks, include both source and
          target.
        </p>
      )}
      <div
        className="source-control-mode-switch"
        role="group"
        aria-label={github ? 'GitHub sign-in method' : 'GitLab token type'}
      >
        <button
          type="button"
          aria-pressed={github ? browser : fine}
          onClick={() => (github ? onBrowserChange(true) : setFine(true))}
        >
          {github ? 'Browser' : 'Fine-grained'}
        </button>
        <button
          type="button"
          aria-pressed={github ? !browser : !fine}
          onClick={() => (github ? onBrowserChange(false) : setFine(false))}
        >
          {github ? 'Classic PAT' : 'Legacy PAT'}
        </button>
      </div>
      {github ? (
        <>
          <p className="source-control-step-hint">
            {browser
              ? 'gh will request the required permissions in your browser. No separate token is needed.'
              : 'Create a classic PAT with these scopes:'}
          </p>
          <div className="source-control-scopes">
            {scopes.map(([scope, hint]) => (
              <Tooltip key={scope} content={hint}>
                <button type="button">
                  <code>{scope}</code>
                </button>
              </Tooltip>
            ))}
          </div>
        </>
      ) : fine ? (
        <>
          <table className="source-control-permissions">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Permissions</th>
              </tr>
            </thead>
            <tbody>
              {rights.map(([resource, permission]) => (
                <tr key={resource}>
                  <td>{resource}</td>
                  <td>{permission}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="source-control-https">
            <input
              type="checkbox"
              checked={https}
              onChange={(event) => setHttps(event.target.checked)}
            />
            Git over HTTPS
          </label>
          <p className="source-control-setup-note">
            Git over HTTPS permissions are not needed when the remote uses SSH.
          </p>
        </>
      ) : (
        <>
          <div className="source-control-scopes">
            <code>api</code>
            <code>write_repository</code>
          </div>
          <p className="source-control-step-hint">
            The standard glab scopes. A legacy PAT covers all projects available to your account.
          </p>
        </>
      )}
      {(!github || !browser) && (
        <>
          <div className="source-control-setup-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setError('');
                void desktop
                  .external(tokenUrl.href)
                  .catch((error: Error) => setError(error.message));
              }}
            >
              Create {github ? 'classic PAT' : 'token'} <ArrowUpRight size={13} aria-hidden />
            </button>
            <CopyButton
              value={
                github
                  ? 'repo, read:org, gist'
                  : fine
                    ? rights
                        .map(([resource, permission]) => `${resource}: ${permission}`)
                        .join('\n')
                    : 'api, write_repository'
              }
              label={`Copy ${github ? 'GitHub' : 'GitLab'} permissions`}
            />
          </div>
          {github && (
            <p className="source-control-setup-note">
              If your organization uses SSO, authorize the token for it.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
