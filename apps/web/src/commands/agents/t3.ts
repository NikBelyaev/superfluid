import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import type { Input } from '@superfluid/contracts';

export async function connectT3(pairingLink: string) {
  const t3 = await desktop.call('t3.connect', { pairingLink });
  useApp.setState({ t3 });
}

export async function disconnectT3() {
  const t3 = await desktop.call('t3.disconnect', {});
  useApp.setState({ t3, t3Agents: [], t3Dismissed: [], t3Drafts: {} });
}

export async function respondToT3(input: Input<'t3.respond'>) {
  await desktop.call('t3.respond', input);
}

export async function queueT3Message(input: Input<'t3.queue'>) {
  return desktop.call('t3.queue', input);
}

export async function openT3Run(url: string) {
  await desktop.external(url);
}
