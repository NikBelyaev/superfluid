import { useEffect, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, FileCode2, Folder } from 'lucide-react';
import type { FileEntry, Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { documentPath } from '~/state/editor/Documents';
import { useFileGitStatus } from '~/hooks/useFileGitStatus';
import { fileLabelClassName } from '~/components/vcs/fileLabels';

const menuItemClassName =
  'flex min-h-7 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-sm leading-5 outline-none hover:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-foreground aria-[current=location]:bg-accent aria-[current=location]:text-foreground data-[disabled]:cursor-default data-[disabled]:text-muted-foreground';

function DirectoryItems({
  sessionId,
  directory,
  selected,
  browse,
  getGitStatus,
}: {
  sessionId: string;
  directory: string;
  selected: string;
  browse: (path: string) => void;
  getGitStatus: (path: string) => string | undefined;
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void desktop.call('files.list', { sessionId, path: directory }).then(
      (files) => {
        if (!cancelled) setEntries(files);
      },
      (error: unknown) => {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, directory]);
  return (
    <>
      {error ? (
        <Menu.Item className={menuItemClassName} disabled>
          {error}
        </Menu.Item>
      ) : entries === null ? (
        <Menu.Item className={menuItemClassName} disabled>
          Loading…
        </Menu.Item>
      ) : entries.length === 0 ? (
        <Menu.Item className={menuItemClassName} disabled>
          Empty folder
        </Menu.Item>
      ) : (
        entries.map((entry) => {
          const Icon = entry.directory ? Folder : FileCode2;
          const status = getGitStatus(entry.path);
          return (
            <Menu.Item
              className={menuItemClassName}
              key={entry.path}
              title={entry.path}
              aria-label={entry.name}
              aria-description={status ? `Git: ${status}` : undefined}
              aria-current={entry.path === selected ? 'location' : undefined}
              closeOnClick={!entry.directory}
              onClick={() => {
                if (entry.directory) browse(entry.path);
                else void useApp.getState().openFile(entry.path);
              }}
            >
              <Icon size={13} aria-hidden="true" />
              <span
                className={`overflow-hidden text-ellipsis whitespace-nowrap ${fileLabelClassName(status)}`}
                data-git-status={status}
              >
                {entry.name}
              </span>
              {status && status !== 'ignored' && !entry.directory && (
                <small
                  className={`ml-auto flex-none ${fileLabelClassName(status)}`}
                  aria-hidden="true"
                >
                  {status === 'added' ? 'A' : status === 'conflict' ? '!' : status[0].toUpperCase()}
                </small>
              )}
              {entry.directory && <ChevronRight size={12} aria-hidden="true" />}
            </Menu.Item>
          );
        })
      )}
    </>
  );
}

function PathSegment({
  sessionId,
  name,
  path,
  directory,
  getGitStatus,
}: {
  sessionId: string;
  name: string;
  path: string;
  directory: boolean;
  getGitStatus: (path: string) => string | undefined;
}) {
  const parent = directory ? path : path.split('/').slice(0, -1).join('/');
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(parent);
  const Icon = directory ? Folder : FileCode2;
  const status = getGitStatus(path);
  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setBrowsing(parent);
      }}
    >
      <Menu.Trigger
        className="flex min-w-0 items-center gap-[5px] rounded-[3px] px-1 py-0.5 text-sm leading-4 text-muted-foreground hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground"
        title={path || name}
        aria-description={status ? `Git: ${status}` : undefined}
      >
        <Icon size={12} aria-hidden="true" />
        <span
          className={`overflow-hidden text-ellipsis whitespace-nowrap ${fileLabelClassName(status)}`}
          data-git-status={status}
        >
          {name}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-[110]" side="top" align="start" sideOffset={4}>
          <Menu.Popup
            className="z-90 max-h-[min(320px,var(--available-height))] w-max min-w-[180px] max-w-[min(360px,var(--available-width))] overflow-y-auto rounded-lg border border-solid border-border bg-popover p-1 shadow-[var(--shadow-popover)] outline-none"
            aria-label="Path navigation"
          >
            {open && (
              <DirectoryItems
                key={browsing}
                sessionId={sessionId}
                directory={browsing}
                selected={path}
                browse={setBrowsing}
                getGitStatus={getGitStatus}
              />
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function FileBreadcrumbs({ session, path }: { session: Session; path: string }) {
  const getGitStatus = useFileGitStatus(session.id);
  const project = useApp((state) =>
    state.projects.find((project) => project.id === session.projectId),
  );
  if (path.startsWith('file://'))
    return (
      <span
        className="flex min-w-0 overflow-hidden text-sm leading-4 text-ellipsis"
        title={documentPath(path)}
      >
        {documentPath(path)}
      </span>
    );
  const names = path.split('/');
  const segments = [
    { name: project?.name ?? 'Project', path: '', directory: true },
    ...names.map((name, index) => ({
      name,
      path: names.slice(0, index + 1).join('/'),
      directory: index < names.length - 1,
    })),
  ];
  return (
    <nav
      className="flex min-w-0 overflow-hidden text-sm leading-4 text-ellipsis"
      aria-label="File path"
    >
      {segments.map((segment, index) => (
        <span
          className="flex min-w-0 items-center last:max-w-[70%] last:shrink-0"
          key={segment.path}
        >
          {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
          <PathSegment sessionId={session.id} getGitStatus={getGitStatus} {...segment} />
        </span>
      ))}
    </nav>
  );
}
