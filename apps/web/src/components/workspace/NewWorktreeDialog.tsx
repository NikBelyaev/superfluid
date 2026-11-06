import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useApp, currentSession } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';

export function NewWorktreeDialog() {
  const session = currentSession()!,
    status = useApp((a) => a.git[session.id]),
    [branch, setBranch] = useState(''),
    [base, setBase] = useState(session.branch || 'HEAD');
  return (
    <Form
      label="Create worktree"
      submit={async () => {
        const created = await desktop.call('session.create', {
          sessionId: session.id,
          branch,
          base,
        });
        const app = useApp.getState(),
          project = app.projects.find((p) => p.id === session.projectId)!;
        await app.openProject(project);
        useApp.getState().switchSession(created.id);
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
