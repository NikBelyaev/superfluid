import type { ParsedInput, Session, PullRequestRef } from '@superfluid/contracts';
import { HostingService } from '../hosting/HostingService';
import { safeRef } from '../vcs/gitCommand';
import { Gate } from '../utils/Gate';

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
  async patch(session: Session, input: ParsedInput<'pr.patch'>) {
    const { target, provider } = await this.selected(session, input.ref);
    return provider.patch(target, input.ref.number);
  }
  async comments(session: Session, input: ParsedInput<'pr.comments'>) {
    const { target, provider } = await this.selected(session, input.ref);
    return provider.comments(target, input.ref.number, input.page);
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
