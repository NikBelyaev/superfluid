import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { useApp, currentSession } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';
import { closeDialog as close } from '~/state/dialogs';

export function FileDialog({
  directory,
  parent,
  path,
}: {
  directory?: boolean;
  parent?: string;
  path?: string;
}) {
  const s = currentSession()!,
    [name, setName] = useState(path ?? (parent ? parent + '/' : ''));
  const matches = (p: string) => !!path && (p === path || p.startsWith(path + '/'));
  return (
    <Form
      label={path ? 'Rename' : directory ? 'Create folder' : 'Create file'}
      submit={async () => {
        const { documents } = await import('~/state/editor/Documents');
        if (path) {
          documents.assertClean(s.id, path);
          await desktop.call('files.rename', { sessionId: s.id, path, target: name });
          documents.removePaths(s.id, path);
          const a = useApp.getState(),
            v = a.views[s.id],
            mapped = (p: string) => (matches(p) ? name + p.slice(path.length) : p);
          const surface = (p: any) => (p?.kind === 'file' ? { ...p, path: mapped(p.path) } : p);
          a.setView(
            {
              tabs: v.tabs.map(mapped),
              active: v.active ? mapped(v.active) : null,
              expanded: v.expanded.map(mapped),
              editorViews: Object.fromEntries(
                Object.entries(v.editorViews ?? {}).map(([key, value]) => [
                  key.slice(0, 5) + mapped(key.slice(5)),
                  value,
                ]),
              ),
              history: v.history.map((x) => ({ ...x, path: mapped(x.path) })),
              surface: surface(v.surface),
              rightTabs: v.rightTabs.map(surface),
            },
            s.id,
          );
        } else {
          await desktop.call('files.create', {
            sessionId: s.id,
            path: name,
            directory: !!directory,
          });
          if (!directory && useApp.getState().sessionId === s.id)
            await useApp.getState().openFile(name);
        }
        useApp.setState((a) => ({ revision: a.revision + 1 }));
        await useApp.getState().refreshGit(s.id);
      }}
      danger={
        path && (
          <button
            type="button"
            className="text-button negative"
            onClick={async () => {
              if (!confirm(`Move ${path} to the Trash?`)) return;
              try {
                const { documents } = await import('~/state/editor/Documents');
                documents.assertClean(s.id, path);
                await desktop.trash(s.id, path);
                documents.removePaths(s.id, path);
                const a = useApp.getState(),
                  v = a.views[s.id],
                  rightTabs = v.rightTabs.filter((x) => x.kind !== 'file' || !matches(x.path));
                a.setView(
                  {
                    tabs: v.tabs.filter((x) => !matches(x)),
                    active: v.active && matches(v.active) ? null : v.active,
                    rightTabs,
                    editorViews: Object.fromEntries(
                      Object.entries(v.editorViews ?? {}).filter(([key]) => !matches(key.slice(5))),
                    ),
                    surface:
                      v.surface?.kind === 'file' && matches(v.surface.path)
                        ? (rightTabs.at(-1) ?? null)
                        : v.surface,
                  },
                  s.id,
                );
                useApp.setState((a) => ({ revision: a.revision + 1 }));
                close();
              } catch (e) {
                useApp.getState().fail(e);
              }
            }}
          >
            Move to Trash
          </button>
        )
      }
    >
      <label>
        {path ? 'New path' : 'Path relative to worktree'}
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={directory ? 'src' : 'main.py'}
        />
      </label>
    </Form>
  );
}
