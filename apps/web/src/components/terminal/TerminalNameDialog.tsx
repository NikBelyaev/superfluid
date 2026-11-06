import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { Form } from '~/components/dialogs/DialogForm';

export function TerminalNameDialog({ id, name: initial }: { id: string; name: string }) {
  const [name, setName] = useState(initial);
  return (
    <Form
      label="Rename terminal"
      submit={async () => {
        await desktop.call('terminal.command', { id, command: 'rename', data: name });
      }}
    >
      <label>
        Terminal name
        <input
          autoFocus
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Form>
  );
}
