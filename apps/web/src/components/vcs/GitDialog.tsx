import { desktop } from '~/rpc/desktop';
import { useEffect, useState } from 'react';
import { repositoryConnection, type HostingContext } from '@superfluid/contracts';
import { PullRequestFields } from '~/components/pullRequest/PullRequestFields';
import { RepositoryRemotePicker } from '~/components/pullRequest/RepositoryRemotePicker';
import { GitBranch } from 'lucide-react';
import { useApp, currentSession, showSurface } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';

export function GitDialog({
  action,
  sessionId,
  repositoryId,
}: {
  action: 'commit' | 'push' | 'pr' | 'publish';
  sessionId?: string;
  repositoryId?: string;
}) {
  const selectedRepositoryId = useApp(
    (app) => app.views[sessionId ?? app.sessionId ?? '']?.repositoryIds?.[0],
  );
  repositoryId ??= selectedRepositoryId;
  const [s] = useState(
      () =>
        useApp.getState().sessions.find((session) => session.id === sessionId) ?? currentSession()!,
    ),
    status = useApp((a) => (repositoryId ? a.repositoryGit[s.id]?.[repositoryId] : a.git[s.id]));
  const [operationId] = useState(() => crypto.randomUUID()),
    [message, setMessage] = useState(''),
    [base, setBase] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [draft, setDraft] = useState(true),
    [selected, setSelected] = useState<string[]>(
      status?.files.filter((f) => f.index !== '?').map((f) => f.path) ?? [],
    );
  const [context, setContext] = useState<HostingContext | null>(null),
    [contextError, setContextError] = useState('');
  const project = useApp((app) => app.projects.find((project) => project.id === s.projectId));
  const path =
    useApp(
      (app) => app.repositories[s.id]?.find((repository) => repository.id === repositoryId)?.path,
    ) ?? '';
  const { remote, binding } = repositoryConnection(project, path);
  const [targetProject, setTargetProject] = useState<{
    remote: string | undefined;
    project: string;
  }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (action !== 'pr' && action !== 'publish') return;
    let cancelled = false;
    setContext(null);
    setContextError('');
    setBase('');
    void desktop
      .call('pr.context', {
        sessionId: s.id,
        repositoryId,
        targetProject: targetProject?.remote === remote ? targetProject?.project : undefined,
      })
      .then((context) => {
        if (!cancelled) setContext(context);
      })
      .catch((error: Error) => {
        if (!cancelled) setContextError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [action, s.id, repositoryId, remote, binding, targetProject, retry]);
  const term = context?.provider === 'gitlab' ? 'MR' : 'PR';
  return (
    <Form
      label={
        action === 'publish'
          ? `Commit, push & ${term}`
          : action === 'pr'
            ? `Create ${context?.provider === 'gitlab' ? 'merge' : 'pull'} request`
            : action === 'push'
              ? 'Push branch'
              : 'Commit changes'
      }
      submit={async () => {
        if ((action === 'pr' || action === 'publish') && !context)
          throw new Error(contextError || 'Wait for the hosting connection.');
        const { documents } = await import('~/state/editor/Documents');
        const dirty = [...documents.items.values()].filter(
          (d) => d.session.id === s.id && d.dirty && (!path || d.path.startsWith(path + '/')),
        );
        if (dirty.length)
          throw new Error(
            `Save ${dirty.length} unsaved file${dirty.length === 1 ? '' : 's'} before publishing.`,
          );
        const op = await desktop.call('git.act', {
          sessionId: s.id,
          repositoryId,
          operationId,
          action,
          message,
          paths: selected,
          base: base || context?.defaultBranch,
          hostingRevision: context?.revision,
          targetProject: context?.targetProject,
          title: title || message.split('\n')[0] || s.branch,
          body,
          draft,
        });
        await useApp.getState().refreshGit(s.id);
        if (op.error) throw new Error(op.error);
        if (op.url) showSurface({ kind: 'pr', repositoryId, ref: op.pullRequest }, s.id);
      }}
    >
      <div className="git-target">
        <GitBranch size={14} />
        <strong>{status?.branch || s.branch}</strong>
        <span className="muted">in {s.path.split('/').at(-1)}</span>
      </div>
      {action !== 'commit' && (
        <RepositoryRemotePicker key={retry} session={s} repositoryId={repositoryId} />
      )}
      {(action === 'commit' || action === 'publish') && (
        <>
          <label>
            Commit message
            <textarea
              autoFocus
              required
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (!title) setTitle(e.target.value.split('\n')[0]);
              }}
              rows={3}
              placeholder="Describe the change"
            />
          </label>
          <label>Files to stage</label>
          <div className="commit-files">
            {status?.files.map((file) => (
              <label className="checkbox-row" key={file.path}>
                <input
                  type="checkbox"
                  checked={selected.includes(file.path)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, file.path]
                        : selected.filter((x) => x !== file.path),
                    )
                  }
                />
                <span className="git-letter">
                  {file.index === '?' ? 'U' : file.worktree !== '.' ? file.worktree : file.index}
                </span>
                <span>{file.path}</span>
              </label>
            ))}
          </div>
          <p className="field-hint">
            Already staged files are also included. New files and directories are selected
            explicitly. Selecting a directory stages its contents.
          </p>
        </>
      )}
      {(action === 'pr' || action === 'publish') && (
        <>
          {contextError && (
            <p className="form-error" role="alert">
              {contextError}{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </button>
            </p>
          )}
          {context && (
            <>
              <p className="field-hint">
                {context.host} · {context.sourceProject} → {context.targetProject}
              </p>
              <label>
                Target project
                <select
                  aria-label="Target project"
                  value={context.targetProject}
                  onChange={(event) => setTargetProject({ remote, project: event.target.value })}
                >
                  {[
                    ...new Set(
                      [
                        context.sourceProject,
                        context.upstreamProject,
                        context.targetProject,
                      ].filter((value): value is string => !!value),
                    ),
                  ].map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <PullRequestFields
            term={term}
            value={{
              title: title || message.split('\n')[0] || s.branch,
              body,
              baseRefName: base || context?.defaultBranch || '',
              draft,
            }}
            onChange={(value) => {
              setTitle(value.title);
              setBody(value.body);
              setBase(value.baseRefName);
              setDraft(value.draft);
            }}
          />
        </>
      )}
      {action === 'publish' && (
        <p className="field-hint">
          Runs Commit → Push → Create {term} in order. Unexpected Git changes stop publication.
        </p>
      )}
    </Form>
  );
}
