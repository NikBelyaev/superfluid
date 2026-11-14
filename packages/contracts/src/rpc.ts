import { z } from 'zod';
import { t3Requests, type T3Results, type T3Agent, type T3Integration } from './agents/t3';
import { projectRequests, type ProjectResults, type Project } from './project';
import { filesRequests, type FileResults } from './files';
import { searchRequests, type SearchResults } from './search';
import { vcsRequests, type VcsResults, type Operation } from './vcs';
import {
  terminalRequests,
  type TerminalResults,
  type Action,
  type Run,
  type TerminalServer,
} from './terminal';
import { pythonRequests, type PythonResults } from './python';
import { pullRequestRequests, type PullRequestResults } from './pullRequest';
import {
  codexRequests,
  type CodexResults,
  type CodexAgent,
  type CodexIntegration,
} from './agents/codex';

export const requests = {
  bootstrap: z.object({}),
  ...projectRequests,
  ...filesRequests,
  ...searchRequests,
  ...vcsRequests,
  ...terminalRequests,
  ...pythonRequests,
  ...pullRequestRequests,
  ...codexRequests,
  ...t3Requests,
} as const;

export type Method = keyof typeof requests;

export type Input<M extends Method> = z.input<(typeof requests)[M]>;

export type ParsedInput<M extends Method> = z.output<(typeof requests)[M]>;

export interface Results
  extends
    ProjectResults,
    FileResults,
    SearchResults,
    VcsResults,
    TerminalResults,
    PythonResults,
    PullRequestResults,
    CodexResults,
    T3Results {
  bootstrap: {
    projects: Project[];
    actions: Action[];
    runs: Run[];
    servers: TerminalServer[];
    operations: Operation[];
    codex: CodexIntegration;
    codexAgents: CodexAgent[];
    t3: T3Integration;
    t3Agents: T3Agent[];
  };
}
