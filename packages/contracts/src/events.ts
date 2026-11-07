import type { Run, TerminalFrame } from './terminal';
import type { Operation } from './vcs';
import type { Project } from './project';
import type { PullRequestRef } from './pullRequest';
import type { PythonStatus } from './python';

export type AppEvent =
  | { type: 'project'; project: Project }
  | { type: 'pr.changed'; sessionId: string; ref: PullRequestRef }
  | { type: 'terminal.frame'; frame: TerminalFrame }
  | { type: 'runs'; runs: Run[] }
  | { type: 'operation'; operation: Operation }
  | { type: 'files.changed'; sessionId: string }
  | {
      type: 'diagnostics';
      sessionId: string;
      generation: number;
      server: 'ty' | 'pyright';
      uri: string;
      diagnostics: any[];
    }
  | PythonStatus
  | { type: 'error'; message: string };
