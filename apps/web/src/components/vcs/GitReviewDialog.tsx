import { desktop } from '~/rpc/desktop';
import { useState, useEffect } from 'react';
import { useApp } from '~/state/workspaceStore';
import type { Results } from '@superfluid/contracts';
import { Form } from '~/components/dialogs/DialogForm';

export function GitReviewDialog({ id, sessionId }: { id: string; sessionId: string }) {
  const [inspection, setInspection] = useState<Results['git.inspect'] | null>(null),
    [checked, setChecked] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void desktop
      .call('git.inspect', { sessionId, operationId: id })
      .then((value) => {
        if (!cancelled) setInspection(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, id]);
  return (
    <Form
      label="Allow a new Git operation"
      submit={async () => {
        if (!checked || !inspection)
          throw new Error('Inspect the local log and remote before acknowledging this attempt.');
        const operation = await desktop.call('git.acknowledge', {
          sessionId,
          operationId: id,
        });
        useApp.setState((a) => ({
          operations: [...a.operations.filter((o) => o.id !== operation.id), operation],
        }));
      }}
    >
      <p className="modal-description">
        We couldn’t confirm how your last Git action finished. Check the result below to continue.
        This won’t retry or undo the action.
      </p>
      {error && <p className="form-error">{error}</p>}
      {inspection ? (
        <>
          {inspection.operation.url && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void desktop.external(inspection.operation.url!).catch(useApp.getState().fail)
              }
            >
              Open request on server
            </button>
          )}
          <label>
            Recent Git activity<pre className="inspection">{inspection.log}</pre>
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
