import { useState } from 'react';
import type { PullRequest, PullRequestChanges } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { Form } from '~/components/dialogs/DialogForm';
import { PullRequestFields, type PullRequestFieldsValue } from './PullRequestFields';

export function EditPullRequestDialog({
  sessionId,
  repositoryId,
  request,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequest;
}) {
  const [value, setValue] = useState<PullRequestFieldsValue>({
    title: request.title,
    body: request.body,
    baseRefName: request.baseRefName,
    draft: request.draft,
  });
  return (
    <Form
      label="Save changes"
      submit={async () => {
        const changes: PullRequestChanges = {};
        if (value.title !== request.title) changes.title = value.title;
        if (value.body !== request.body) changes.body = value.body;
        if (value.baseRefName !== request.baseRefName) changes.baseRefName = value.baseRefName;
        if (value.draft !== request.draft) changes.draft = value.draft;
        if (Object.keys(changes).length)
          await desktop.call('pr.update', {
            sessionId,
            repositoryId,
            ref: request.ref,
            expectedUpdatedAt: request.updatedAt,
            changes,
          });
      }}
    >
      <PullRequestFields
        value={value}
        onChange={setValue}
        term={request.ref.provider === 'gitlab' ? 'MR' : 'PR'}
      />
    </Form>
  );
}
