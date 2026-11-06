import type { Session, ParsedInput, PullRequest } from '@superfluid/contracts';
import { GitService } from '../vcs/GitService';

export class PullRequestService {
  constructor(private git: GitService) {}
  async read(session: Session, input: ParsedInput<'pr.read'>) {
    const fields =
      'number,title,body,state,url,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,comments,commits,reviews,statusCheckRollup,files';
    const raw = await this.git.github(session, [
      'pr',
      'view',
      ...(input.number ? [String(input.number)] : []),
      '--json',
      fields,
    ]);
    const pr = JSON.parse(raw);
    if (
      typeof pr.number !== 'number' ||
      typeof pr.title !== 'string' ||
      !/^https:\/\//.test(pr.url)
    )
      throw new Error('Unexpected pull request response.');
    return pr as PullRequest;
  }
  async patch(session: Session, input: ParsedInput<'pr.patch'>) {
    return await this.git.github(session, ['pr', 'diff', String(input.number), '--color', 'never']);
  }
  async comment(session: Session, input: ParsedInput<'pr.comment'>) {
    await this.git.github(
      session,
      ['pr', 'comment', String(input.number), '--body-file', '-'],
      input.body,
    );
    return null;
  }
}
