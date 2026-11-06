import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';

export function CloneRepositoryDialog() {
  const [url, setUrl] = useState(''),
    [destination, setDestination] = useState('');
  return (
    <Form
      label="Clone repository"
      submit={async () => {
        const p = await desktop.call('project.clone', { url, destination });
        await useApp.getState().bootstrap();
        await useApp.getState().openProject(p);
      }}
    >
      <label>
        Repository URL
        <input
          autoFocus
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git@github.com:owner/project.git"
        />
      </label>
      <label>
        Destination
        <div className="input-group">
          <input
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="/path/to/project"
          />
          <button
            className="button"
            type="button"
            onClick={async () => {
              const p = await desktop.chooseDirectory();
              if (p) {
                const name =
                  url
                    .split('/')
                    .at(-1)
                    ?.replace(/\.git$/, '') || 'project';
                setDestination(p + '/' + name);
              }
            }}
          >
            <FolderOpen size={15} />
          </button>
        </div>
      </label>
    </Form>
  );
}
