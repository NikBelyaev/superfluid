import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { useApp, currentSession } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';

export function InterpreterDialog() {
  const s = currentSession()!,
    [python, setPython] = useState(s.python);
  return (
    <Form
      label="Use interpreter"
      submit={async () => {
        const updated = await desktop.call('session.interpreter', {
          sessionId: s.id,
          python,
        });
        useApp.setState((a) => ({
          sessions: a.sessions.map((x) => (x.id === s.id ? updated : x)),
        }));
      }}
    >
      <p className="modal-description">
        This interpreter applies to Python intelligence and typed Python actions in this worktree.
      </p>
      <label>
        Python interpreter
        <input
          autoFocus
          required
          value={python}
          onChange={(e) => setPython(e.target.value)}
          placeholder="/path/to/.venv/bin/python"
        />
      </label>
    </Form>
  );
}
