import type { Action, Operation } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import type { TabGroup } from './workspaceView';

export const closeDialog = () => useApp.setState({ modal: null });
export const openLanguageSettings = () =>
  useApp.setState({ modal: { kind: 'settings', section: 'languages' }, palette: null });

export const openGitReview = (operation: Operation) =>
  useApp.setState({
    modal: { kind: 'git-review', id: operation.id, sessionId: operation.sessionId },
    repositoryMenu: null,
    palette: null,
  });

export type SettingsSection = 'appearance' | 'languages' | 'hosting' | 'agents' | 'about';

export type Modal =
  | { kind: 'settings'; section?: SettingsSection }
  | { kind: 'action'; action?: Action }
  | { kind: 'worktree' }
  | {
      kind: 'git';
      action: 'commit' | 'push' | 'pr' | 'publish';
      sessionId?: string;
      repositoryId?: string;
    }
  | { kind: 'git-review'; id: string; sessionId: string }
  | { kind: 'terminal-name'; id: string; name: string }
  | { kind: 'clone' }
  | { kind: 'interpreter' }
  | { kind: 'launcher'; group?: TabGroup; sessionId?: string }
  | { kind: 'rename-symbol'; edit?: any; source?: { path: string; line: number; column: number } }
  | null;
