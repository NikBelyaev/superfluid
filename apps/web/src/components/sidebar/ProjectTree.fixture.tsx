import { createRoot } from 'react-dom/client';
import type { Bridge, FileEntry, Session } from '@superfluid/contracts';
import ProjectTree from './ProjectTree';
import { useApp } from '~/state/workspaceStore';
import { emptyView } from '~/state/workspaceView';
import { documents, type Doc } from '~/state/editor/Documents';
import { trashFiles } from '~/commands/files';

const session = { id: 'source', path: '/fixture/source' } as Session;
const other = { id: 'other', path: '/fixture/other' } as Session;
const entries: FileEntry[] = ['src', 'src-other'].map((path) => ({
  name: path,
  path,
  directory: true,
  symlink: false,
}));
const files = new Map([
  [session.id, entries],
  [other.id, [{ name: 'one.py', path: 'one.py', directory: false, symlink: false }]],
]);
const listeners = new Set<Parameters<Bridge['onEvent']>[0]>();
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const fixture = {
  useApp,
  trashFiles,
  files,
  trashed: [] as { sessionId: string; path: string }[],
  drafts: new Set<string>(),
  failure: '',
  signal,
  pause: null as ReturnType<typeof signal> | null,
  entered: signal(),
  dirty(path: string) {
    documents.items.set(`source:${path}`, { session, path, dirty: true } as Doc);
  },
  clean() {
    documents.items.clear();
  },
};
declare global {
  interface Window {
    treeFixture: typeof fixture;
  }
}
window.treeFixture = fixture;
window.superfluid = {
  call: async (method: string, input: { path?: string; sessionId?: string }) => {
    if (method === 'files.list' && 'path' in input)
      return (files.get(input.sessionId!) ?? []).filter(
        (entry) => entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/'))) === input.path,
      );
    if (method === 'files.create' && 'path' in input && typeof input.path === 'string') {
      entries.push({
        name: input.path.split('/').at(-1)!,
        path: input.path,
        directory: false,
        symlink: false,
      });
      return null;
    }
    if (method === 'files.resolve' && fixture.drafts.has(`${input.sessionId}:${input.path}`))
      throw new Error('Unsaved recovery draft');
    return null;
  },
  onEvent: (listener: Parameters<Bridge['onEvent']>[0]) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  trash: async (sessionId: string, path: string) => {
    fixture.entered.resolve();
    await fixture.pause?.promise;
    if (fixture.failure === path) throw new Error('Trash failed');
    const entries = files.get(sessionId)!;
    const removed = entries.filter(
      (entry) => entry.path === path || entry.path.startsWith(path + '/'),
    );
    if (!removed.length) throw new Error('File missing');
    for (const entry of removed) entries.splice(entries.indexOf(entry), 1);
    fixture.trashed.push({ sessionId, path });
    for (const listener of listeners) listener({ type: 'files.changed', sessionId });
  },
} as unknown as Bridge;
useApp.setState({
  sessions: [session, other],
  sessionId: session.id,
  views: { [session.id]: emptyView(), [other.id]: emptyView() },
  refreshGit: async () => {},
  openFile: async (path) => {
    const active = { kind: 'file', path } as const;
    useApp.getState().setView({ active, tabs: [active] }, session.id);
    document.querySelector<HTMLTextAreaElement>('#editor')?.focus();
  },
});
function Fixture() {
  const sessionId = useApp((state) => state.sessionId);
  const error = useApp((state) => state.error);
  return (
    <>
      <ProjectTree session={sessionId === other.id ? other : session} />
      <textarea id="editor" />
      <output>{error}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
