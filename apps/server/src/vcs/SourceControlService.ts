import type { Session, ParsedInput } from '@superfluid/contracts';
import { GitService } from './GitService';
import { ProjectService } from '../project/ProjectService';
import { Store } from '../persistence/Store';
import { git } from './gitCommand';
import { within } from '../files/paths';
import { assertNoDrafts } from '../files/drafts';

export class SourceControlService {
  constructor(
    private git: GitService,
    private projects: ProjectService,
    private store: Store,
  ) {}
  async initialize(session: Session) {
    if (session.gitDir) throw new Error('This folder is already a Git repository.');
    await git(session.path, ['init', '-b', 'main']);
    return this.projects.sessions(session.projectId);
  }
  async diff(session: Session, input: ParsedInput<'git.diff'>) {
    if (input.path) await within(session.path, input.path, true);
    return this.git.diff(session, input.path, input.mode, input.base);
  }
  act(session: Session, input: ParsedInput<'git.act'>) {
    if (['commit', 'publish'].includes(input.action)) assertNoDrafts(this.store, session, '');
    return this.git.act(session, input);
  }
}
