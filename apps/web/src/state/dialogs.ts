import type { Action, PullRequest } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';

export const closeDialog = () => useApp.setState({ modal: null });

export type Modal =
  | { kind: 'settings'; section?: 'appearance' | 'hosting' }
  | { kind: 'action'; action?: Action }
  | { kind: 'worktree' }
  | {
      kind: 'git';
      action: 'commit' | 'push' | 'pr' | 'publish';
      sessionId?: string;
      repositoryId?: string;
    }
  | { kind: 'pr-edit'; sessionId: string; repositoryId?: string; request: PullRequest }
  | { kind: 'git-review'; id: string }
  | { kind: 'terminal-name'; id: string; name: string }
  | { kind: 'clone' }
  | { kind: 'new-file'; directory: boolean; parent: string }
  | { kind: 'rename'; path: string }
  | { kind: 'interpreter' }
  | { kind: 'launcher' }
  | { kind: 'rename-symbol'; edit?: any; source?: { path: string; line: number; column: number } }
  | null;
