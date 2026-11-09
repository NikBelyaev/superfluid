import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useApp, currentSession } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';
import { createRepositoryWorktree } from '~/commands/gitBatch';
import { selectedRepositories } from '~/state/repositories';

export function NewWorktreeDialog() {
  const session = currentSession()!,
    status = useApp((a) => a.git[session.id]),
    repositories = useApp((a) => a.repositories[session.id]),
    ids = useApp((a) => a.views[session.id]?.repositoryIds),
    group = selectedRepositories(repositories || [], ids),
    nested = group.some((r) => r.path),
    [branch, setBranch] = useState(''),
    [base, setBase] = useState(nested ? 'HEAD' : session.branch || 'HEAD');
  return (
    <Form
      label="Create worktree"
      submit={async () => {
        if (nested) {
          await createRepositoryWorktree(
            session,
            group.map((r) => r.id),
            branch,
            base,
          );
          return;
        }
        const { documents } = await import('~/state/editor/Documents');
        await documents.saveSession(session.id, ['']);
        const created = await desktop.call('session.create', {
          sessionId: session.id,
          branch,
          base,
        });
        const app = useApp.getState(),
          project = app.projects.find((p) => p.id === session.projectId)!;
        await app.openProject(project);
        await useApp.getState().switchSession(created.id);
      }}
    >
      <p className="modal-description">
        A separate folder and working session. Your current changes and processes stay here.
      </p>
      <label>
        Branch name
        <input
          autoFocus
          required
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/my-change"
        />
      </label>
      <label>
        Start from
        <input
          required
          list="branch-options"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
        <datalist id="branch-options">
          {status?.branches.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <div className="hint-box">
        <GitBranch size={15} />
        The worktree gets its own files, editor state and terminals. Dependencies are not installed
        automatically.
      </div>
    </Form>
  );
}
