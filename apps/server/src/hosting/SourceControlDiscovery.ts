import { z } from 'zod';
import {
  hostingBindingSchema,
  type SourceControlAccount,
  type SourceControlDiscovery as Discovery,
  type SourceControlTool,
} from '@superfluid/contracts';
import { command, ProcessError } from '../process/ProcessRunner';
import { Gate } from '../utils/Gate';

const githubAuth = z.object({
  hosts: z.record(
    z.string(),
    z.array(z.object({ login: z.string(), state: z.string(), active: z.boolean() })),
  ),
});
const gitlabAuth = z.object({
  hosts: z.array(
    z.object({
      host: hostingBindingSchema.shape.host,
      user: z.string().optional(),
      state: z.string(),
    }),
  ),
});

export function parseSourceControlAccounts(
  kind: 'github' | 'gitlab',
  raw: string,
): SourceControlAccount[] {
  const value: unknown = JSON.parse(raw);
  if (kind === 'github')
    return Object.entries(githubAuth.parse(value).hosts).flatMap(([host, accounts]) =>
      accounts.map((account) => ({
        host: hostingBindingSchema.shape.host.parse(host),
        login: account.login,
        authenticated: account.state === 'success',
        active: account.active,
      })),
    );
  return gitlabAuth.parse(value).hosts.map((account) => ({
    host: account.host,
    login: account.user ?? null,
    authenticated: account.state === 'success' && !!account.user,
    active: true,
  }));
}

export class SourceControlDiscovery {
  private gate = new Gate(2);
  private pending?: Promise<Discovery>;
  private current?: Discovery;
  constructor(
    private cwd: string,
    private run = command,
  ) {}
  scan(): Promise<Discovery> {
    if (this.pending) return this.pending;
    this.pending = Promise.all([
      this.probe('git', 'Git', 'git'),
      this.probe('github', 'GitHub', 'gh'),
      this.probe('gitlab', 'GitLab', 'glab'),
    ])
      .then(
        ([git, github, gitlab]) =>
          (this.current = {
            versionControlSystems: [git],
            sourceControlProviders: [github, gitlab],
          }),
      )
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async forHost(host: string) {
    const find = (result: Discovery) =>
      result.sourceControlProviders.filter((tool) =>
        tool.accounts.some((account) => account.host === host),
      );
    const found = this.current && find(this.current);
    return found?.length ? found : find(await this.scan());
  }
  private async probe(
    kind: SourceControlTool['kind'],
    label: string,
    executable: string,
  ): Promise<SourceControlTool> {
    const tool: SourceControlTool = {
      kind,
      label,
      executable,
      status: 'available',
      version: null,
      auth: null,
      accounts: [],
      detail: 'Available',
    };
    const options = {
      cwd: this.cwd,
      timeout: 15000,
      limit: 512 * 1024,
      env: {
        NO_COLOR: '1',
        GH_PROMPT_DISABLED: '1',
        GH_DEBUG: undefined,
        GLAB_CHECK_UPDATE: 'false',
        GLAB_DEBUG_HTTP: undefined,
        GITLAB_TOKEN: undefined,
        GITLAB_ACCESS_TOKEN: undefined,
        OAUTH_TOKEN: undefined,
        GLAB_ENABLE_CI_AUTOLOGIN: 'false',
      },
    };
    try {
      const raw = await this.gate.run(() => this.run(executable, ['--version'], options));
      const match = raw.match(/^(?:git version|gh version|glab(?: version)?)\s+v?([^\s]+)/i);
      if (!match) throw new Error('Unexpected version output.');
      tool.version = match[1];
    } catch (error) {
      tool.status =
        error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'error';
      tool.detail =
        tool.status === 'missing'
          ? `Install ${executable} on this machine to enable ${label}.`
          : `Could not run ${executable} --version.`;
      return tool;
    }
    if (kind === 'git') return tool;
    let raw: string;
    const args =
      kind === 'github'
        ? ['auth', 'status', '--json', 'hosts']
        : ['auth', 'status', '--all', '--output', 'json'];
    try {
      raw = await this.gate.run(() => this.run(executable, args, options));
    } catch (error) {
      if (!(error instanceof ProcessError) || !error.stdout)
        return {
          ...tool,
          auth: 'unknown',
          detail: `Could not verify ${label}. Run ${executable} auth status to check your CLI connection.`,
        };
      raw = error.stdout;
    }
    try {
      tool.accounts = parseSourceControlAccounts(kind, raw);
      tool.auth = tool.accounts.some((account) => account.active && account.authenticated)
        ? 'authenticated'
        : 'unauthenticated';
      tool.detail =
        tool.auth === 'authenticated'
          ? 'Authenticated using your CLI credentials.'
          : `Sign in with ${executable} auth login, then rescan.`;
    } catch {
      tool.auth = 'unknown';
      tool.detail = `Could not read ${executable} authentication status. Update the CLI and rescan.`;
    }
    return tool;
  }
}
