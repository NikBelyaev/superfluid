import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter, once } from 'node:events';
import type { Doc } from './Documents';
import { desktop } from '~/rpc/desktop';
import { acceptPythonStatus } from '~/state/python';
import { Workspace } from '../../../../server/src/workspace/Workspace';
import { git } from '../../../../server/src/vcs/gitCommand';
import { repository, temp, terminalWorker, pythonProbe } from '../../../../../tests/fixtures';

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} refreshes cached documents after a branch update without replacing dirty buffers`, async (t) => {
    // Only Monaco's model is replaced; disk reads, Git and Python diagnostics are real.
    const hook = registerHooks({
      resolve(specifier, context, next) {
        if (specifier === '~/components/editor/monaco')
          return { url: 'data:text/javascript,export const monaco = {};', shortCircuit: true };
        return next(specifier, context);
      },
    });
    const { documents } = await import('./Documents');
    hook.deregister();
    const root = await repository(),
      events = new EventEmitter(),
      workspace = new Workspace(
        await temp(),
        (event) => {
          if (event.type === 'lsp.status') acceptPythonStatus(event);
          if (event.type === 'diagnostics' && event.uri.endsWith('/main.py'))
            events.emit(
              `${event.sessionId}:${event.diagnostics.length ? 'error' : 'clean'}`,
              event,
            );
        },
        { terminalWorker },
      );
    t.mock.method(desktop, 'call', workspace.call.bind(workspace));
    try {
      const before = 'value: str = 1\n',
        after = 'value: str = "updated"\n';
      await writeFile(join(root, 'main.py'), before);
      await git(root, ['commit', '-am', 'Before update']);
      await git(root, ['switch', '-c', 'updated']);
      await writeFile(join(root, 'main.py'), after);
      await git(root, ['commit', '-am', 'Fix assignment']);
      await git(root, ['switch', 'main']);
      const project = await workspace.projects.add(root),
        [session] = await workspace.projects.sessions(project.id);
      session.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9]);
      workspace.store.put('sessions', session);
      let text = before;
      const disk = await workspace.call('files.read', { sessionId: session.id, path: 'main.py' });
      const doc: Doc = {
        key: documents.key(session.id, 'main.py'),
        session,
        path: 'main.py',
        model: {
          getValue: () => text,
          setValue: (value: string) => {
            text = value;
          },
          getLanguageId: () => 'python',
          isDisposed: () => false,
          isAttachedToEditor: () => false,
        } as Doc['model'],
        hash: disk.hash,
        version: 1,
        dirty: false,
        recovered: false,
        lastUsed: 0,
        closed: true,
      };
      documents.items.set(doc.key, doc);
      const initial = once(events, `${session.id}:error`, { signal: AbortSignal.timeout(10000) });
      await documents.sync(doc);
      assert.ok((await initial)[0].diagnostics.length);

      await git(root, ['merge', '--ff-only', 'updated']);
      const refreshed = once(events, `${session.id}:clean`, { signal: AbortSignal.timeout(10000) });
      void refreshed.catch(() => {});
      // Reopening a retained document must check disk before resending its overlay.
      await documents.open(session, doc.path);
      assert.equal(text, after);
      await documents.sync(doc);
      assert.deepEqual((await refreshed)[0].diagnostics, []);

      const other = await workspace.call('session.create', {
        sessionId: session.id,
        branch: 'other',
        base: 'main',
      });
      let otherText = before;
      const otherDoc: Doc = {
        ...doc,
        session: other,
        key: documents.key(other.id, doc.path),
        hash: disk.hash,
        model: {
          ...doc.model,
          getValue: () => otherText,
          setValue: (value: string) => {
            otherText = value;
          },
        } as Doc['model'],
      };
      documents.items.set(otherDoc.key, otherDoc);
      documents.activeSessions = [other.id];
      await git(root, ['reset', '--hard', 'HEAD^']);
      const invalidated = once(events, `${session.id}:error`, {
        signal: AbortSignal.timeout(10000),
      });
      await documents.refreshSession(session.id);
      assert.equal(text, before);
      assert.equal(otherText, before);
      await documents.sync(doc);
      assert.ok((await invalidated)[0].diagnostics.length);

      await git(root, ['merge', '--ff-only', 'updated']);
      const activated = once(events, `${session.id}:clean`, { signal: AbortSignal.timeout(10000) });
      Object.assign(globalThis, { requestAnimationFrame: () => 0 });
      t.after(() => {
        Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      });
      await documents.activate(session.id);
      assert.equal(text, after);
      await documents.sync(doc);
      assert.deepEqual((await activated)[0].diagnostics, []);

      doc.dirty = true;
      text = 'value: str = "unsaved"\n';
      await documents.refreshSession(session.id);
      await documents.open(session, doc.path);
      assert.equal(text, 'value: str = "unsaved"\n');

      let finishSaving!: () => void;
      doc.saving = new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
      const reloading = documents.reload(doc);
      doc.version++;
      text = 'value: str = "edited during reload"\n';
      finishSaving();
      await assert.rejects(reloading, /edited this file while it was reloading/);
      assert.equal(text, 'value: str = "edited during reload"\n');
    } finally {
      documents.items.clear();
      documents.activeSessions = [];
      await workspace.close();
    }
  });
