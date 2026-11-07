import type { UpdateRequest } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useUpdates } from '~/state/updates';
import { useApp } from '~/state/workspaceStore';

export async function updateApp(request: UpdateRequest) {
  try {
    useUpdates.setState({ state: await desktop.update(request) });
  } catch (error) {
    useApp.getState().fail(error);
  }
}

export function checkForAppUpdates() {
  useApp.setState({ modal: { kind: 'settings', section: 'about' } });
  void updateApp({ action: 'check' });
}
