import type { Run, TerminalFrame } from './terminal';
import type { Operation } from './vcs';

export type AppEvent =
  | { type: 'terminal.frame'; frame: TerminalFrame }
  | { type: 'runs'; runs: Run[] }
  | { type: 'operation'; operation: Operation }
  | { type: 'files.changed'; sessionId: string }
  | { type: 'diagnostics'; sessionId: string; generation: number; uri: string; diagnostics: any[] }
  | { type: 'lsp.status'; sessionId: string; status: string }
  | { type: 'error'; message: string };
