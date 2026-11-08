import { desktop } from '~/rpc/desktop';
import type { Action, Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';
import type { TabGroup } from '~/state/workspaceView';

export async function runAction(session: Session, action?: Action, group: TabGroup = 'bottom') {
  try {
    const run = await desktop.call('terminal.run', {
      sessionId: session.id,
      ...(action ? { actionId: action.id } : { name: 'Terminal' }),
    });
    showSurface({ kind: 'terminal', id: run.id }, session.id, group);
  } catch (e) {
    useApp.getState().fail(e);
  }
}
