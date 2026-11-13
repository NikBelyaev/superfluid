import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import type { Input } from '@superfluid/contracts';

export async function configureCodex(enabled: boolean) {
  const codex = await desktop.call('codex.configure', { enabled });
  useApp.setState({
    codex,
    ...(!enabled ? { codexAgents: [], codexDismissed: [], codexDrafts: {} } : {}),
  });
}

export async function respondToCodex(input: Input<'codex.respond'>) {
  await desktop.call('codex.respond', input);
}

export async function queueCodexMessage(input: Input<'codex.queue'>) {
  return desktop.call('codex.queue', input);
}

export async function openCodexRun(threadId: string) {
  await desktop.external(`codex://threads/${encodeURIComponent(threadId)}`);
}
