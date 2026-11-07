import { useState } from 'react';
import { CopyButton } from '~/components/ui/CopyButton';
import { Tooltip } from '~/components/ui/Tooltip';

const managers = [
  ['brew', 'Homebrew · macOS and Linux'],
  ['winget', 'WinGet · Windows'],
  ['scoop', 'Scoop · Windows'],
  ['choco', 'Chocolatey · Windows'],
] as const;

export function InstallSnippet({ cli }: { cli: 'gh' | 'glab' }) {
  const [manager, setManager] = useState<(typeof managers)[number][0]>('brew');
  const command =
    manager === 'winget'
      ? cli === 'gh'
        ? 'winget install --id GitHub.cli --source winget'
        : 'winget install glab.glab'
      : `${manager} install ${cli}`;
  return (
    <div className="source-control-snippet">
      <div className="source-control-snippet-heading">
        <div
          className="source-control-package-tabs"
          role="group"
          aria-label={`${cli} package manager`}
        >
          {managers.map(([name, hint]) => (
            <Tooltip key={name} content={hint}>
              <button
                type="button"
                aria-pressed={name === manager}
                onClick={() => setManager(name)}
              >
                {name}
              </button>
            </Tooltip>
          ))}
        </div>
        <CopyButton key={command} value={command} label={`Copy ${cli} install command`} />
      </div>
      <pre>
        <code>
          <span aria-hidden className="source-control-prompt">
            $
          </span>
          <span className="source-control-command">{manager}</span>
          {command.slice(manager.length)}
        </code>
      </pre>
    </div>
  );
}

export function LoginSnippet({ command, cli }: { command: string; cli: string }) {
  return (
    <div className="source-control-snippet">
      <div className="source-control-snippet-heading">
        <span>Terminal</span>
        <CopyButton key={command} value={command} label={`Copy ${cli} login command`} />
      </div>
      <pre>
        <code>
          <span aria-hidden className="source-control-prompt">
            $
          </span>
          {command}
        </code>
      </pre>
    </div>
  );
}
