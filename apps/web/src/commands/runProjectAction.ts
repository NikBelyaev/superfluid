import { desktop } from '~/rpc/desktop';
import type { Action, Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';
import { openLanguageSettings } from '~/state/dialogs';
import type { TabGroup } from '~/state/workspaceView';

export async function runAction(session: Session, action?: Action, group: TabGroup = 'bottom') {
  try {
    if (action?.kind === 'go' && !(await desktop.call('go.packageStatus', {})).goAvailable) {
      if (useApp.getState().sessionId === session.id) openLanguageSettings();
      return;
    }
    const { documents } = await import('~/state/editor/Documents');
    await documents.saveSession(session.id, ['']);
    const run = await desktop.call('terminal.run', {
      sessionId: session.id,
      ...(action ? { actionId: action.id } : { name: 'Terminal' }),
    });
    showSurface({ kind: 'terminal', id: run.id }, session.id, group);
  } catch (e) {
    useApp.getState().fail(e);
  }
}
