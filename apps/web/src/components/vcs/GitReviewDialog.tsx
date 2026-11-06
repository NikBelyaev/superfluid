import { desktop } from '~/rpc/desktop';
import { useState, useEffect } from 'react';
import { currentSession } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';

export function GitReviewDialog({ id }: { id: string }) {
  const s = currentSession()!,
    [inspection, setInspection] = useState<{ log: string; remote: string; operation: any } | null>(
      null,
    ),
    [checked, setChecked] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void desktop
      .call('git.inspect', { sessionId: s.id, operationId: id })
      .then((value) => {
        if (!cancelled) setInspection(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [s.id, id]);
  return (
    <Form
      label="Allow a new Git operation"
      submit={async () => {
        if (!checked || !inspection)
          throw new Error('Inspect the local log and remote before acknowledging this attempt.');
        await desktop.call('git.acknowledge', { sessionId: s.id, operationId: id });
      }}
    >
      <p className="modal-description">
        An earlier operation stopped with an uncertain result. Acknowledging it does not retry or
        undo any Git command.
      </p>
      {error && <p className="form-error">{error}</p>}
      {inspection ? (
        <>
          <label>
            Recent local commits<pre className="inspection">{inspection.log}</pre>
          </label>
          <label>
            Remote branch
            <pre className="inspection">{inspection.remote || 'No remote ref found.'}</pre>
          </label>
          <details>
            <summary>Recorded evidence</summary>
            <pre className="inspection">{JSON.stringify(inspection.operation, null, 2)}</pre>
          </details>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked the local and remote result before starting a new operation.
          </label>
        </>
      ) : (
        <p>Inspecting Git state…</p>
      )}
    </Form>
  );
}
