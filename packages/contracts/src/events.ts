import type { Run, TerminalFrame } from './terminal';
import type { Operation } from './vcs';
import type { Project } from './project';
import type { PullRequestRef } from './pullRequest';
import type { PythonStatus } from './python';
import type { CodexAgent, CodexIntegration } from './agents/codex';
import type { T3Agent, T3Integration } from './agents/t3';

export type AppEvent =
  | { type: 't3'; integration: T3Integration; agents: T3Agent[] }
  | { type: 't3.agent'; agent: T3Agent }
  | { type: 'codex'; integration: CodexIntegration; agents: CodexAgent[] }
  | { type: 'codex.agent'; agent: CodexAgent }
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
