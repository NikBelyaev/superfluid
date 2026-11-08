import type { ParsedInput, Session, PullRequestRef } from '@superfluid/contracts';
import { HostingService } from '../hosting/HostingService';
import { git, safeRef } from '../vcs/gitCommand';
import { Gate } from '../utils/Gate';
import { formatJobLog } from './jobLog';

export class PullRequestService {
  private writers = new Map<string, Gate>();
  constructor(
    private hosting: HostingService,
    private changed: (sessionId: string, ref: PullRequestRef) => void = () => {},
  ) {}
  context(session: Session, targetProject?: string) {
    return this.hosting.context(session, targetProject);
  }
  async list(session: Session, input: ParsedInput<'pr.list'>) {
    const target = await this.hosting.resolve(session);
    if (input.scope === 'branch' && !target.branch)
      throw new Error('Select a named branch to find its requests.');
    return this.hosting.provider(target).list(target, {
      state: input.state,
      page: input.page,
      ...(input.scope === 'branch' ? { branch: target.branch } : {}),
    });
  }
  private async selected(session: Session, ref: PullRequestRef) {
    const target = await this.hosting.resolve(session, ref.project);
    this.hosting.assertRef(target, ref);
    return { target, provider: this.hosting.provider(target) };
  }
  async read(session: Session, input: ParsedInput<'pr.read'>) {
    const target = await this.hosting.resolve(session, input.ref?.project);
    if (input.ref) this.hosting.assertRef(target, input.ref);
    let number = input.ref?.number ?? input.number;
    const provider = this.hosting.provider(target);
    if (!number) {
      const found = await provider.list(target, { state: 'open', page: 1, branch: target.branch });
      if (found.items.length !== 1 || found.hasMore)
        throw new Error('Choose a request from the repository list.');
      number = found.items[0].number;
    }
    const result = await provider.read(target, number);
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.host !== target.host)
      throw new Error('The server returned an unexpected request URL.');
    return result;
  }
  async mergeState(session: Session, input: ParsedInput<'pr.mergeState'>) {
    const { target, provider } = await this.selected(session, input.ref);
    return provider.mergeState(target, input.ref.number);
  }
  async checks(session: Session, input: ParsedInput<'pr.checks'>) {
    const { target, provider } = await this.selected(session, input.ref);
    return provider.checks(target, input.ref.number);
  }
  async merge(session: Session, input: ParsedInput<'pr.merge'>) {
    const key = JSON.stringify(input.ref);
    const gate = this.writers.get(key) ?? new Gate(1);
    this.writers.set(key, gate);
    return gate.run(async () => {
      const { target, provider } = await this.selected(session, input.ref);
      const current = await provider.mergeState(target, input.ref.number);
      if (current.headSha !== input.expectedHeadSha)
        throw new Error(
          'The request head changed. Refresh and review the new commits before merging.',
        );
      if (current.state !== 'open') throw new Error(`This request is already ${current.state}.`);
      if (input.action === 'cancel-auto') {
        if (!current.canManage || !current.autoMerge)
          throw new Error('Auto-merge cannot be canceled for this request.');
      } else {
        if (!current.methods.includes(input.method))
          throw new Error(
            'This merge method is not allowed by the repository. Refresh and choose an available method.',
          );
        if (!(input.action === 'merge' ? current.canMerge : current.canAutoMerge))
          throw new Error(current.reason ?? 'Merging is not available for this request.');
      }
      await this.hosting.assertCurrent(session, target);
      try {
        await provider.merge(target, input.ref.number, input);
        return await provider.mergeState(target, input.ref.number);
      } catch (error) {
        throw new Error(
          `The action may have reached the server. Refresh this request before retrying. ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.changed(session.id, input.ref);
      }
    });
  }
  async patch(session: Session, input: ParsedInput<'pr.patch'>) {
    const { target, provider } = await this.selected(session, input.ref);
    if (input.commit) {
      const sha = (
        await git(target.cwd, ['rev-parse', '--verify', '--quiet', `${input.commit}^{commit}`], {
          accept: [1],
        })
      ).trim();
      if (sha)
        return git(target.cwd, [
          'show',
          '--format=',
          '--no-ext-diff',
          '--no-textconv',
          '--find-renames',
          '--diff-merges=first-parent',
          sha,
          '--',
        ]);
    }
    return provider.patch(target, input.ref.number, input.commit);
  }
  async comments(session: Session, input: ParsedInput<'pr.comments'>) {
    const { target, provider } = await this.selected(session, input.ref);
    return provider.comments(target, input.ref.number, input.page);
  }
  async jobLog(session: Session, input: ParsedInput<'pr.jobLog'>) {
    const { target, provider } = await this.selected(session, input.ref);
    const log = await provider.jobLog(target, input.ref.number, input.jobId);
    return formatJobLog(log.text, log.truncated);
  }
  async timeline(session: Session, input: ParsedInput<'pr.timeline'>) {
    const { target, provider } = await this.selected(session, input.ref);
    return provider.timeline(target, input.ref.number, input.page);
  }
  async comment(session: Session, input: ParsedInput<'pr.comment'>) {
    const { target, provider } = await this.selected(session, input.ref);
    await this.hosting.assertCurrent(session, target);
    await provider.comment(target, input.ref.number, input.body);
    this.changed(session.id, input.ref);
    return null;
  }
  async update(session: Session, input: ParsedInput<'pr.update'>) {
    const key = JSON.stringify(input.ref);
    const gate = this.writers.get(key) ?? new Gate(1);
    this.writers.set(key, gate);
    return gate.run(async () => {
      const { target, provider } = await this.selected(session, input.ref);
      const before = await provider.read(target, input.ref.number);
      if (before.updatedAt !== input.expectedUpdatedAt)
        throw new Error(
          'This request changed on the server. Keep your text and reopen it before saving.',
        );
      if (input.changes.baseRefName) safeRef(input.changes.baseRefName);
      await this.hosting.assertCurrent(session, target);
      try {
        await provider.update(target, input.ref.number, input.changes);
      } catch (error) {
        throw new Error(
          `The update may have reached the server. Refresh the request before retrying. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const result = await provider.read(target, input.ref.number);
      this.changed(session.id, input.ref);
      return result;
    });
  }
}
