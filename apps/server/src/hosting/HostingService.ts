import {
  hostingBindingSchema,
  repositoryConnection,
  type HostingBinding,
  type Session,
  type Project,
  type PullRequestRef,
  type SourceControlRepository,
} from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { command, commandTail } from '../process/ProcessRunner';
import { git } from '../vcs/gitCommand';
import { Gate } from '../utils/Gate';
import { digest } from '../utils/digest';
import { GitHubProvider } from './github/GitHubProvider';
import { GitLabProvider } from './gitlab/GitLabProvider';
import { SourceControlDiscovery } from './SourceControlDiscovery';
import { relative } from 'node:path';
import type { HostingProvider, HostingTarget, RunHosting, RunHostingLog } from './HostingProvider';

export function remoteRepository(remote: string) {
  const scp = remote.match(/^[\w.-]+@([^/:]+):(.+)$/);
  if (scp) return { host: scp[1].toLowerCase(), project: scp[2].replace(/\.git$/, '') };
  const url = new URL(remote);
  if (
    !['https:', 'ssh:'].includes(url.protocol) ||
    url.password ||
    (url.protocol === 'https:' && url.username)
  )
    throw new Error('Use an HTTPS or SSH remote without embedded credentials.');
  return {
    host: url.protocol === 'ssh:' ? url.hostname : url.host,
    project: url.pathname.replace(/^\//, '').replace(/\.git$/, ''),
  };
}

export class HostingService {
  readonly network = new Gate(2);
  private github: GitHubProvider;
  private gitlab: GitLabProvider;
  constructor(
    private store: Store,
    run?: RunHosting,
    private discovery = new SourceControlDiscovery(store.directory),
  ) {
    const options = (target: HostingTarget, input?: string) => ({
      cwd: target.cwd,
      input,
      timeout: 30000,
      env: {
        GH_PROMPT_DISABLED: '1',
        GITLAB_HOST: target.host,
        GLAB_CHECK_UPDATE: 'false',
        GLAB_DEBUG_HTTP: 'false',
        NO_COLOR: '1',
        GITLAB_TOKEN: undefined,
        GITLAB_ACCESS_TOKEN: undefined,
        OAUTH_TOKEN: undefined,
        GLAB_ENABLE_CI_AUTOLOGIN: 'false',
      },
    });
    const invoke = <T>(file: string, target: HostingTarget, work: () => Promise<T>) =>
      this.network.run(async () => {
        try {
          return await work();
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            throw new Error(
              `Install ${file}, then run ${file} auth login --hostname ${target.host}.`,
            );
          if (
            error instanceof Error &&
            /401|not logged in|not authenticated|authentication required/i.test(error.message)
          )
            throw new Error(
              `Sign in to ${target.host}: ${file} auth login --hostname ${target.host}.`,
            );
          throw error;
        }
      });
    const execute: RunHosting =
      run ??
      ((file, args, target, input) =>
        invoke(file, target, () => command(file, args, options(target, input))));
    const log: RunHostingLog = run
      ? async (...args) => ({ text: await run(...args), truncated: false })
      : (file, args, target) =>
          invoke(file, target, () => commandTail(file, args, options(target), 256 * 1024));
    this.github = new GitHubProvider(execute, log);
    this.gitlab = new GitLabProvider(execute, log);
  }
  provider(target: Pick<HostingBinding, 'provider'>): HostingProvider {
    return target.provider === 'gitlab' ? this.gitlab : this.github;
  }
  private settings(session: Session) {
    const project = this.store.get<Project>('projects', session.projectId);
    const root = this.store.get<Session>('sessions', session.id)?.path ?? session.path;
    const path = relative(root, session.path);
    return repositoryConnection(project, path);
  }
  async repository(session: Session): Promise<SourceControlRepository | null> {
    const { selected } = await this.remotes(session);
    if (!selected) return null;
    const { binding } = this.settings(session);
    const remote = remoteRepository(
      (await git(session.path, ['remote', 'get-url', '--push', selected])).trim(),
    );
    const host = hostingBindingSchema.shape.host.parse(binding?.host ?? remote.host);
    return {
      host,
      project: hostingBindingSchema.shape.sourceProject.parse(
        binding?.sourceProject ?? remote.project,
      ),
      provider:
        binding?.provider ??
        (host === 'github.com' ? 'github' : host === 'gitlab.com' ? 'gitlab' : null),
    };
  }
  async remotes(session: Session) {
    const { binding, remote } = this.settings(session);
    const names = (await git(session.path, ['remote'])).trim().split('\n').filter(Boolean);
    const branch = (
      await git(session.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
    ).trim();
    const config = async (key: string) =>
      (await git(session.path, ['config', '--get', key], { accept: [1] })).trim();
    const configured =
      remote ??
      binding?.remote ??
      ((branch ? await config(`branch.${branch}.pushRemote`) : '') ||
        (await config('remote.pushDefault')) ||
        (branch ? await config(`branch.${branch}.remote`) : ''));
    const preferred =
      configured || (names.includes('origin') ? 'origin' : names.length === 1 ? names[0] : null);
    return { names, selected: preferred && names.includes(preferred) ? preferred : null };
  }
  private async providerForHost(host: string) {
    if (host === 'github.com') return 'github';
    if (host === 'gitlab.com') return 'gitlab';
    const configured = await this.discovery.forHost(host);
    const authenticated = configured.filter((tool) =>
      tool.accounts.some(
        (account) => account.host === host && account.authenticated && account.active,
      ),
    );
    const providers = authenticated.length ? authenticated : configured;
    if (providers.length !== 1)
      throw new Error(
        `Sign in to ${host} using glab auth login --hostname ${host} for GitLab, or gh auth login --hostname ${host} for GitHub, then retry.`,
      );
    const tool = providers[0];
    // A limited PAT can fail auth status while still having repository access.
    return tool.kind === 'gitlab' ? 'gitlab' : 'github';
  }
  async resolve(session: Session, targetProject?: string): Promise<HostingTarget> {
    const { binding } = this.settings(session);
    const { selected } = await this.remotes(session);
    if (!selected) throw new Error('Choose a Git remote to load requests or publish this branch.');
    const remoteUrl = (await git(session.path, ['remote', 'get-url', '--push', selected])).trim();
    let resolved = binding;
    if (!resolved) {
      const remote = remoteRepository(remoteUrl);
      resolved = hostingBindingSchema.parse({
        provider: await this.providerForHost(remote.host),
        host: remote.host,
        remote: selected,
        sourceProject: remote.project,
        targetProject: remote.project,
      });
    }
    const branch = (
      await git(session.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
    ).trim();
    let target: HostingTarget = {
      ...resolved,
      branch,
      defaultBranch: '',
      cwd: session.path,
      remoteUrl,
      revision: digest(JSON.stringify({ binding: resolved, remoteUrl, branch })),
    };
    if (!binding) {
      const repository = await this.provider(target).repository(target);
      const destination = hostingBindingSchema.shape.targetProject.parse(
        targetProject ?? repository.upstreamProject ?? resolved.sourceProject,
      );
      target = {
        ...target,
        sourceProjectId: repository.id,
        targetProject: destination,
        upstreamProject: repository.upstreamProject,
        defaultBranch: repository.defaultBranch,
      };
      if (destination !== resolved.sourceProject)
        target.defaultBranch = await this.provider(target).defaultBranch(target);
    } else if (targetProject)
      target.targetProject = hostingBindingSchema.shape.targetProject.parse(targetProject);
    target.revision = digest(
      JSON.stringify({ binding: resolved, targetProject: target.targetProject, remoteUrl, branch }),
    );
    return target;
  }
  async context(session: Session, targetProject?: string) {
    const target = await this.resolve(session, targetProject);
    return {
      provider: target.provider,
      host: target.host,
      remote: target.remote,
      sourceProject: target.sourceProject,
      targetProject: target.targetProject,
      upstreamProject: target.upstreamProject,
      branch: target.branch,
      defaultBranch: target.defaultBranch || (await this.provider(target).defaultBranch(target)),
      revision: target.revision,
    };
  }
  assertRef(target: HostingTarget, ref: PullRequestRef) {
    if (
      target.provider !== ref.provider ||
      target.host !== ref.host ||
      target.targetProject !== ref.project
    )
      throw new Error(
        'This request belongs to another repository or server. Reopen it from this worktree.',
      );
  }
  async assertCurrent(session: Session, expected: HostingTarget) {
    if ((await this.resolve(session, expected.targetProject)).revision !== expected.revision)
      throw new Error(
        'The branch, remote or hosting connection changed. Reopen the action before continuing.',
      );
  }
}
