import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmod, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AppEvent,
  CodexAgent,
  CodexIntegration,
  ParsedInput,
  Session,
} from '@superfluid/contracts';
import { CodexHooks, codexHookEvents } from './CodexHooks';
import { codexActivity, codexChangedFiles, codexToolLabel } from './codexActivity';
import { command } from '../../process/ProcessRunner';

const text = z.string().max(8192);
const hookEvent = z.object({
  session_id: z.string().min(1).max(256),
  cwd: text.refine(isAbsolute),
  hook_event_name: z.enum(codexHookEvents),
  turn_id: z.string().max(256).nullish(),
  agent_id: z.string().max(256).nullish(),
  model: z.string().max(256).nullish(),
  last_assistant_message: z.string().max(32768).nullish(),
  tool_name: z.string().max(256).optional(),
  tool_use_id: z.string().max(256).optional(),
  tool_failed: z.boolean().optional(),
  tool_input: z
    .object({ command: text.optional(), file_path: text.optional(), description: text.nullish() })
    .default({}),
});

type PendingApproval = {
  agentId: string;
  sessionId: string;
  finish: (decision?: 'allow' | 'deny') => void;
  approval: NonNullable<CodexAgent['approval']>;
};

export class CodexService {
  readonly hooks: CodexHooks;
  readonly ready: Promise<void>;
  private server = createServer((request, response) => {
    void this.receive(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(400);
      response.end('{}');
    });
  });
  private socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\superfluid-codex-${randomUUID()}`
      : join(tmpdir(), `sf-codex-${randomUUID()}.sock`);
  private agents = new Map<string, CodexAgent>();
  private turns = new Map<string, string>();
  private approvals = new Map<string, PendingApproval>();
  private integration: CodexIntegration;
  private closed = false;
  private listenerError: string | undefined;
  private queueing = new Set<string>();

  constructor(
    directory: string,
    private sessions: () => Session[],
    private emit: (event: AppEvent) => void,
    options: { home?: string; executable?: string } = {},
  ) {
    this.hooks = new CodexHooks(directory, options);
    this.integration = { enabled: false, configPath: this.hooks.configPath };
    this.ready = this.start().catch((error: Error) => {
      this.listenerError = error.message;
      this.integration = { ...this.integration, error: this.listenerError };
    });
  }

  private async start() {
    await mkdir(this.hooks.directory, { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') await chmod(this.socketPath, 0o600);
    await writeFile(this.hooks.connectionFile, JSON.stringify({ socketPath: this.socketPath }), {
      mode: 0o600,
    });
    try {
      this.integration = await this.hooks.status();
      if (this.integration.enabled) await this.hooks.updateHelper();
    } catch (error) {
      this.integration = {
        ...this.integration,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async status() {
    await this.ready;
    try {
      this.integration = {
        ...(await this.hooks.status()),
        ...(this.listenerError ? { error: this.listenerError } : {}),
      };
    } catch (error) {
      this.integration = {
        enabled: false,
        configPath: this.hooks.configPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return this.integration;
  }

  list() {
    return [...this.agents.values()];
  }

  async configure(enabled: boolean) {
    await this.ready;
    if (!this.server.listening)
      throw new Error('Codex status listener is unavailable. Restart Superfluid.');
    this.integration = await this.hooks.configure(enabled);
    if (!enabled) {
      for (const request of [...this.approvals.values()]) request.finish();
      this.agents.clear();
      this.turns.clear();
    }
    this.emit({ type: 'codex', integration: this.integration, agents: this.list() });
    return this.integration;
  }

  respond(input: ParsedInput<'codex.respond'>) {
    const request = this.approvals.get(input.requestId);
    if (!request || request.agentId !== input.agentId || request.sessionId !== input.sessionId)
      throw new Error('This Codex permission request is no longer waiting.');
    request.finish(input.decision);
    return null;
  }

  async queue(input: ParsedInput<'codex.queue'>) {
    const agent = this.agents.get(input.agentId);
    const session = this.sessions().find((item) => item.id === input.sessionId && item.available);
    if (
      !this.integration.enabled ||
      this.closed ||
      !agent ||
      !session ||
      agent.sessionId !== session.id
    )
      throw new Error('This Codex session is no longer available in this worktree.');
    if (!z.uuid().safeParse(agent.threadId).success)
      throw new Error('This Codex session does not have a valid thread UUID.');
    if (this.queueing.has(agent.threadId))
      throw new Error('A message is already being queued for this Codex session.');
    this.queueing.add(agent.threadId);
    try {
      await command('codex', ['queue', '--thread', agent.threadId, `--message=${input.message}`], {
        cwd: session.path,
        timeout: 15000,
        limit: 65536,
        env: {
          CODEX_HOME: dirname(this.hooks.configPath),
          PATH: [process.env.PATH, join(homedir(), '.local', 'bin')]
            .filter(Boolean)
            .join(delimiter),
        },
      });
      if (!this.closed && this.integration.enabled && this.agents.get(agent.id) === agent)
        this.publish({ ...agent, status: 'queued' });
      return { status: 'queued' as const };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        throw new Error('Install Codex CLI to send messages from Superfluid.');
      throw error;
    } finally {
      this.queueing.delete(agent.threadId);
    }
  }

  private publish(agent: CodexAgent) {
    this.agents.set(agent.id, agent);
    this.emit({ type: 'codex.agent', agent });
  }

  private async receive(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== 'POST' || request.url !== '/hook' || request.headers.origin) {
      response.writeHead(404).end('{}');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 262144) {
        response.writeHead(413).end('{}');
        return;
      }
      chunks.push(chunk);
    }
    const event = hookEvent.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    // Session lifetime is not evidence that a turn started or stopped.
    if (
      !this.integration.enabled ||
      this.closed ||
      event.hook_event_name === 'SessionStart' ||
      event.hook_event_name === 'SessionEnd'
    ) {
      response.end('{}');
      return;
    }
    const cwd = await realpath(event.cwd);
    const candidates = await Promise.all(
      this.sessions()
        .filter((session) => session.available)
        .map(async (session) => ({
          session,
          root: await realpath(session.path).catch(() => session.path),
        })),
    );
    const destination = candidates
      .filter(({ root }) => {
        const path = relative(root, cwd);
        return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
      })
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (!destination || !this.integration.enabled || this.closed || response.destroyed) {
      response.end('{}');
      return;
    }
    const { session, root } = destination;
    const id = `${event.session_id}${event.agent_id ? ':' + event.agent_id : ''}`;
    if (this.agents.get(id)?.sessionId !== session.id)
      for (const pending of [...this.approvals.values()])
        if (pending.agentId === id) pending.finish();
    const previous = this.agents.get(id);
    if (
      event.hook_event_name === 'Interrupt' &&
      (!previous || !['working', 'needs-input'].includes(previous.status))
    ) {
      response.end('{}');
      return;
    }
    // A native session can change directories; its next event rebinds it to the destination worktree.
    const now = Date.now();
    if (
      event.hook_event_name !== 'UserPromptSubmit' &&
      event.turn_id &&
      this.turns.has(id) &&
      this.turns.get(id) !== event.turn_id
    ) {
      response.end('{}');
      return;
    }
    if (!previous && this.agents.size >= 128) {
      const idle = [...this.agents.values()].find(
        (agent) => !['working', 'needs-input'].includes(agent.status),
      );
      if (!idle) {
        response.end('{}');
        return;
      }
      this.agents.delete(idle.id);
      this.turns.delete(idle.id);
    }
    const agent: CodexAgent = previous
      ? {
          ...previous,
          sessionId: session.id,
          model: event.model ?? previous.model,
          updatedAt: now,
          steps: [...previous.steps],
        }
      : {
          id,
          threadId: event.session_id,
          runId: event.turn_id ?? undefined,
          sessionId: session.id,
          model: event.model ?? 'Codex',
          status: 'idle',
          startedAt: now,
          updatedAt: now,
          steps: [],
        };
    if (event.hook_event_name === 'UserPromptSubmit') {
      for (const pending of [...this.approvals.values()])
        if (pending.agentId === id) pending.finish();
      if (event.turn_id) this.turns.set(id, event.turn_id);
      else this.turns.delete(id);
      agent.status = 'working';
      agent.runId = event.turn_id ?? randomUUID();
      agent.startedAt = now;
      agent.steps = [];
      agent.files = [];
      delete agent.message;
      delete agent.approval;
    } else if (event.hook_event_name === 'PreToolUse' || event.hook_event_name === 'PostToolUse') {
      const stepId = event.tool_use_id ?? randomUUID();
      const index = agent.steps.findIndex((step) => step.id === stepId);
      if (event.hook_event_name === 'PreToolUse') {
        const step = {
          id: stepId,
          ...codexActivity(event.tool_name ?? 'tool', event.tool_input, root),
          startedAt: now,
        };
        if (index < 0) agent.steps.push(step);
        else agent.steps[index] = step;
      } else if (index >= 0)
        agent.steps[index] = {
          ...agent.steps[index],
          endedAt: now,
          outcome: event.tool_failed ? 'failed' : 'completed',
        };
      else
        agent.steps.push({
          id: stepId,
          ...codexActivity(event.tool_name ?? 'tool', event.tool_input, root),
          startedAt: now,
          endedAt: now,
          outcome: event.tool_failed ? 'failed' : 'completed',
        });
      agent.steps = agent.steps.slice(-8);
      if (event.hook_event_name === 'PostToolUse' && !event.tool_failed)
        agent.files = [
          ...new Set([
            ...(agent.files ?? []),
            ...codexChangedFiles(event.tool_name ?? '', event.tool_input, root, cwd, event.cwd),
          ]),
        ].slice(0, 1000);
      agent.status = agent.approval ? 'needs-input' : 'working';
    } else if (event.hook_event_name === 'Stop' || event.hook_event_name === 'Interrupt') {
      if (event.last_assistant_message) agent.message = event.last_assistant_message;
      for (const pending of [...this.approvals.values()])
        if (pending.agentId === id) pending.finish();
      delete agent.approval;
      agent.steps = agent.steps.map((step) =>
        step.endedAt ? step : { ...step, endedAt: now, outcome: 'stopped' },
      );
      agent.status = event.hook_event_name === 'Stop' ? 'done' : 'stopped';
    }
    if (event.hook_event_name === 'PermissionRequest') {
      if (this.approvals.size >= 32) {
        response.end('{}');
        return;
      }
      const requestId = randomUUID();
      const activity = codexActivity(event.tool_name ?? 'tool', event.tool_input, root);
      agent.status = 'needs-input';
      const approval = {
        id: requestId,
        label:
          event.tool_name === 'Bash' && event.tool_input.command
            ? `Needs approval: ${event.tool_input.command.split('\n')[0].slice(0, 100)}`
            : `Allow ${codexToolLabel(event.tool_name ?? 'tool')}?`,
        detail: activity.detail,
        reason: event.tool_input.description ?? undefined,
        activity: activity.activity,
        startedAt: now,
      };
      agent.approval ??= approval;
      const finish = (decision?: 'allow' | 'deny') => {
        if (!this.approvals.delete(requestId)) return;
        clearTimeout(timer);
        const current = this.agents.get(id);
        if (current?.approval?.id === requestId) {
          const next = [...this.approvals.values()].find(
            (pending) => pending.agentId === id,
          )?.approval;
          const updated = {
            ...current,
            status: next || !decision ? ('needs-input' as const) : ('working' as const),
            updatedAt: Date.now(),
            approval: next,
          };
          this.publish(updated);
        }
        response.end(
          JSON.stringify(
            decision
              ? {
                  hookSpecificOutput: {
                    hookEventName: 'PermissionRequest',
                    decision: {
                      behavior: decision,
                      ...(decision === 'deny' ? { message: 'Declined in Superfluid.' } : {}),
                    },
                  },
                }
              : {},
          ),
        );
      };
      const timer = setTimeout(() => finish(), 290000);
      timer.unref();
      this.approvals.set(requestId, { agentId: id, sessionId: session.id, finish, approval });
      response.on('close', () => finish());
      this.publish(agent);
      return;
    }
    this.publish(agent);
    response.end('{}');
  }

  async close() {
    this.closed = true;
    await this.ready;
    for (const request of [...this.approvals.values()]) request.finish();
    this.server.closeAllConnections();
    if (this.server.listening)
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    const connection = await readFile(this.hooks.connectionFile, 'utf8').catch(() => '');
    if (connection === JSON.stringify({ socketPath: this.socketPath }))
      await rm(this.hooks.connectionFile, { force: true });
    if (process.platform !== 'win32') await rm(this.socketPath, { force: true });
  }
}
