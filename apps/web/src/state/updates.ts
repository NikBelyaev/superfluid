import { create } from 'zustand';
import { useEffect } from 'react';
import type { UpdateState } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from './workspaceStore';

export const useUpdates = create<{ state: UpdateState | null }>(() => ({ state: null }));

export function useUpdateEvents() {
  useEffect(() => {
    let received = false;
    let disposed = false;
    const stop = desktop.onUpdate((state) => {
      received = true;
      useUpdates.setState({ state });
    });
    const stopMenu = desktop.onShowUpdates(() =>
      useApp.setState({ modal: { kind: 'settings', section: 'about' } }),
    );
    void desktop
      .update({ action: 'state' })
      .then((state) => {
        if (!received && !disposed) useUpdates.setState({ state });
      })
      .catch(useApp.getState().fail);
    return () => {
      disposed = true;
      stop();
      stopMenu();
    };
  }, []);
}
