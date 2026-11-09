import { z } from 'zod';
import { projectRequests, type ProjectResults, type Project } from './project';
import { filesRequests, type FileResults } from './files';
import { searchRequests, type SearchResults } from './search';
import { vcsRequests, type VcsResults, type Operation } from './vcs';
import { terminalRequests, type TerminalResults, type Action, type Run } from './terminal';
import { pythonRequests, type PythonResults } from './python';
import { pullRequestRequests, type PullRequestResults } from './pullRequest';

export const requests = {
  bootstrap: z.object({}),
  ...projectRequests,
  ...filesRequests,
  ...searchRequests,
  ...vcsRequests,
  ...terminalRequests,
  ...pythonRequests,
  ...pullRequestRequests,
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
    PullRequestResults {
  bootstrap: { projects: Project[]; actions: Action[]; runs: Run[]; operations: Operation[] };
}
