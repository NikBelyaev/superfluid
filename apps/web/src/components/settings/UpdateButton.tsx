import { Rocket } from 'lucide-react';
import { useUpdates } from '~/state/updates';
import { useApp } from '~/state/workspaceStore';

export function UpdateButton({ compact = false }: { compact?: boolean }) {
  const status = useUpdates((s) => s.state?.status);
  if (!status || !['available', 'downloading', 'downloaded', 'error'].includes(status)) return null;
  const label =
    status === 'downloaded'
      ? 'Update ready'
      : status === 'error'
        ? 'Update needs attention'
        : status === 'downloading'
          ? 'Downloading update'
          : 'Update available';
  return (
    <button
      className={compact ? 'rail-button' : 'welcome-nav-item'}
      title={label}
      aria-label={label}
      onClick={() => useApp.setState({ modal: { kind: 'settings', section: 'about' } })}
    >
      <Rocket size={18} />
      {!compact && label}
    </button>
  );
}
