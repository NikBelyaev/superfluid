import { mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { z } from 'zod';
import type {
  AppEvent,
  Session,
  T3Agent,
  T3Integration,
  ParsedInput,
  AgentStep,
} from '@superfluid/contracts';
import * as protocol from './t3Protocol';
import { T3Socket } from './T3Socket';
import { codexActivity } from '../codex/codexActivity';

type Detail = {
  subscriptionId: string;
  sequence: number;
  runId: string | null;
  steps: AgentStep[];
  message?: { id: string; text: string; updatedAt: number };
  requests: Map<string, protocol.T3RuntimeRequest>;
  approvals: Map<string, protocol.T3TurnItem>;
};

export class T3Service {
  readonly ready: Promise<void>;
  private file: string;
  private t3Home: string;
  private connection?: z.infer<typeof protocol.credentials>;
  private socket?: T3Socket;
  private controller = new AbortController();
  private retry?: ReturnType<typeof setTimeout>;
  private backoff = 1000;
  private generation = 0;
  private closed = false;
  private changes = Promise.resolve();
  private refreshes = Promise.resolve();
  private nextSubscription = 0;
  private shellSequence = -1;
  private integration: T3Integration = { enabled: false, connected: false };
  private projects = new Map<string, z.infer<typeof protocol.project>>();
  private threads = new Map<string, protocol.T3Thread>();
  private agents = new Map<string, T3Agent>();
  private details = new Map<string, Detail>();
  private paths = new Map<string, Promise<string | undefined>>();

  constructor(
    private directory: string,
    private sessions: () => Session[],
    private emit: (event: AppEvent) => void,
    options: { home?: string } = {},
  ) {
    this.directory = join(directory, 't3');
    this.file = join(this.directory, 'connection.json');
    this.t3Home = options.home ?? process.env.T3CODE_HOME ?? join(homedir(), '.t3');
    this.ready = this.load();
  }

  private async load() {
    try {
      const saved = await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      if (!saved) return;
      this.connection = protocol.credentials.parse(JSON.parse(saved));
      this.integration = { enabled: true, connected: false, origin: this.connection.origin };
      void this.open(this.generation);
    } catch {
      this.integration = {
        enabled: false,
        connected: false,
        error: 'Could not read the T3 connection. Connect again.',
      };
    }
  }

  async status() {
    await this.ready;
    return this.integration;
  }
  list() {
    return [...this.agents.values()];
  }

  private publish() {
    this.emit({ type: 't3', integration: this.integration, agents: this.list() });
  }

  private async request(
    origin: string,
    path: string,
    body?: URLSearchParams,
    token?: string,
    method = 'POST',
  ) {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: 'error',
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'T3 access expired or was denied. Create a new pairing link and connect again.'
          : 'T3 did not accept the connection. Check that T3 is running.',
      );
    const text = await response.text();
    if (text.length > 65536) throw new Error('Invalid T3 response.');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('T3 returned invalid connection data.');
    }
  }

  connect(pairingLink: string) {
    return this.change(async () => {
      const parsed = protocol.pairing(pairingLink);
      const { token } = parsed;
      const origin = parsed.origin ?? (await this.runningOrigin(parsed.profile ?? 'userdata'));
      const environment = protocol.environment.safeParse(
        await this.request(origin, '/.well-known/t3/environment', undefined, undefined, 'GET'),
      );
      if (!environment.success)
        throw new Error(
          'This integration requires T3 with orchestration protocol 2. Update T3 and try again.',
        );
      const result = protocol.accessToken.parse(
        await this.request(
          origin,
          '/oauth/token',
          new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: token,
            subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            scope: 'orchestration:read orchestration:operate',
            client_label: 'Superfluid',
            client_device_type: 'desktop',
          }),
        ),
      );
      if (
        !['orchestration:read', 'orchestration:operate'].every((scope) =>
          result.scope.split(' ').includes(scope),
        )
      )
        throw new Error('Use a T3 pairing link with read and operate access.');
      const connection = {
        origin,
        token: result.access_token,
        environmentId: environment.data.environmentId,
      };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(connection), { mode: 0o600 });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
      this.stop();
      this.connection = connection;
      this.integration = { enabled: true, connected: false, origin };
      this.publish();
      await this.open(this.generation);
      return this.integration;
    });
  }

  private async runningOrigin(profile: string) {
    try {
      const { pid, origin } = z
        .object({
          pid: z.number().int().positive(),
          origin: z.string().transform(protocol.localOrigin),
        })
        .parse(
          JSON.parse(await readFile(join(this.t3Home, profile, 'server-runtime.json'), 'utf8')),
        );
      process.kill(pid, 0);
      return origin;
    } catch {
      throw new Error('Open T3 Code on this computer, then try its pairing link again.');
    }
  }

  disconnect() {
    return this.change(async () => {
      await rm(this.file, { force: true });
      this.stop();
      this.connection = undefined;
      this.integration = { enabled: false, connected: false };
      this.publish();
      return this.integration;
    });
  }

  private change<T>(operation: () => Promise<T>) {
    const task = this.changes.then(async () => {
      await this.ready;
      if (this.closed) throw new Error('Superfluid is closing.');
      return operation();
    });
    this.changes = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  private stop() {
    this.generation++;
    this.shellSequence = -1;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.controller.abort();
    this.controller = new AbortController();
    this.socket?.close();
    this.socket = undefined;
    this.projects.clear();
    this.threads.clear();
    this.agents.clear();
    this.details.clear();
    this.paths.clear();
  }

  private async open(generation: number) {
    if (!this.connection || this.closed || generation !== this.generation) return;
    const { origin, token } = this.connection;
    try {
      const result = protocol.ticket.parse(
        await this.request(origin, '/api/auth/websocket-ticket', undefined, token),
      );
      if (generation !== this.generation || this.closed) return;
      const url = new URL('/ws', origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('wsTicket', result.ticket);
      url.searchParams.set('orchestrationProtocol', '2');
      const socket = new T3Socket(
        url,
        async (id, item) => {
          if (generation !== this.generation || this.closed) return;
          if (id === 'shell') await this.shell(item);
          else if (id.startsWith('thread:')) {
            const threadId = id.slice(id.indexOf(':', 7) + 1);
            if (this.details.get(threadId)?.subscriptionId === id) this.detail(threadId, item);
          }
        },
        (error) => this.offline(generation, error),
      );
      this.socket = socket;
      await socket.ready;
      if (generation !== this.generation || this.closed) {
        socket.close();
        return;
      }
      socket.subscribe('shell', 'orchestration.subscribeShell', {});
    } catch (error) {
      if (generation !== this.generation || this.closed) return;
      this.offline(generation, error instanceof Error ? error.message : 'Could not connect to T3.');
    }
  }

  private offline(generation: number, error = 'T3 disconnected. Reconnecting…') {
    if (generation !== this.generation || this.closed || this.retry) return;
    this.socket?.close();
    this.socket = undefined;
    const nextGeneration = ++this.generation;
    this.shellSequence = -1;
    this.agents.clear();
    this.details.clear();
    this.integration = { ...this.integration, connected: false, error };
    this.publish();
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.open(nextGeneration);
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
    this.retry.unref();
  }

  private async shell(raw: unknown) {
    const item = protocol.shellItem.parse(raw);
    if (item.kind === 'synchronized') return;
    // Enrichment snapshots contain projects only and do not advance the live-event cursor.
    if (item.kind === 'snapshot' && item.resolvedRepositoryIdentityRoots) {
      for (const project of item.snapshot.projects) this.projects.set(project.id, project);
      await this.refresh();
      return;
    }
    const sequence = item.kind === 'snapshot' ? item.snapshot.snapshotSequence : item.sequence;
    if (sequence <= this.shellSequence) return;
    this.shellSequence = sequence;
    if (item.kind === 'snapshot') {
      this.projects = new Map(item.snapshot.projects.map((project) => [project.id, project]));
      this.threads = new Map(item.snapshot.threads.map((thread) => [thread.id, thread]));
      this.integration = { enabled: true, connected: true, origin: this.connection!.origin };
      this.backoff = 1000;
    } else if (item.kind === 'project.updated') this.projects.set(item.project.id, item.project);
    else if (item.kind === 'project.removed') {
      this.projects.delete(item.projectId);
      for (const thread of this.threads.values())
        if (thread.projectId === item.projectId) this.threads.delete(thread.id);
    } else if (item.kind === 'thread.updated') {
      if (item.location === 'active') this.threads.set(item.thread.id, item.thread);
      else this.threads.delete(item.thread.id);
    } else if (item.kind === 'thread.removed') this.threads.delete(item.threadId);
    else return;
    await this.refresh(
      item.kind === 'thread.updated'
        ? [item.thread.id]
        : item.kind === 'thread.removed'
          ? [item.threadId]
          : undefined,
    );
  }

  private canonical(path: string) {
    let pending = this.paths.get(path);
    if (!pending) {
      pending = realpath(path).catch(() => {
        this.paths.delete(path);
        return undefined;
      });
      this.paths.set(path, pending);
    }
    return pending;
  }

  refresh(ids?: string[]) {
    const task = this.refreshes.then(() => this.sync(ids));
    this.refreshes = task.catch(() => {});
    return task;
  }

  private async sync(ids?: string[]) {
    if (!this.socket || !this.integration.connected || this.closed) return;
    const generation = this.generation;
    const roots = await Promise.all(
      this.sessions()
        .filter((session) => session.available)
        .map(async (session) => ({
          session,
          root: (await this.canonical(session.path)) ?? session.path,
        })),
    );
    const next = ids ? new Map(this.agents) : new Map<string, T3Agent>();
    for (const id of ids ?? []) next.delete(id);
    const threads = ids
      ? ids.flatMap((id) => this.threads.get(id) ?? [])
      : [...this.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const thread of threads) {
      if (
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.settledOverride === 'settled' ||
        thread.settledAt !== null
      )
        continue;
      const path = thread.worktreePath ?? this.projects.get(thread.projectId)?.workspaceRoot;
      if (!path) continue;
      const cwd = await this.canonical(path);
      if (!cwd) continue;
      const destination = roots
        .filter(({ root }) => {
          const path = relative(root, cwd);
          return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
        })
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (!destination) continue;
      if (generation !== this.generation || !this.socket) return;
      if (next.size >= 128) {
        const idle = [...next.values()].findLast(
          (agent) => !['working', 'needs-input'].includes(agent.status),
        );
        if (!idle) continue;
        next.delete(idle.id);
      }
      const runId = thread.activeRunId ?? thread.latestRunId;
      let detail = this.details.get(thread.id);
      if (detail && detail.runId !== runId) {
        this.socket.unsubscribe(detail.subscriptionId);
        detail = undefined;
      }
      if (!detail) {
        detail = {
          subscriptionId: `thread:${++this.nextSubscription}:${thread.id}`,
          sequence: -1,
          runId,
          steps: [],
          requests: new Map(),
          approvals: new Map(),
        };
        this.details.set(thread.id, detail);
        this.socket.subscribe(detail.subscriptionId, 'orchestration.subscribeThread', {
          threadId: thread.id,
          acceptBoundedSnapshot: true,
          acceptCompactTurnItems: false,
        });
      }
      const previous = this.agents.get(thread.id);
      next.set(thread.id, {
        id: thread.id,
        threadId: thread.id,
        runId: runId ?? undefined,
        sessionId: destination.session.id,
        title: thread.title,
        model: thread.modelSelection.model,
        url: `t3code://threads/${encodeURIComponent(this.connection!.environmentId)}/${encodeURIComponent(thread.id)}`,
        status: 'idle',
        startedAt: thread.latestRunStartedAt ?? thread.latestRunRequestedAt ?? thread.createdAt,
        updatedAt: thread.updatedAt,
        steps: detail.steps,
        ...(previous?.approval ? { approval: previous.approval } : {}),
      });
      if (next.size === 128) break;
    }
    if (generation !== this.generation || !this.socket) return;
    for (const id of this.details.keys())
      if (!next.has(id)) {
        this.socket.unsubscribe(this.details.get(id)!.subscriptionId);
        this.details.delete(id);
      }
    this.agents = next;
    for (const id of ids ?? next.keys()) this.project(id, false);
    if (ids?.length === 1 && next.has(ids[0]))
      this.emit({ type: 't3.agent', agent: next.get(ids[0])! });
    else this.publish();
  }

  private detail(id: string, raw: unknown) {
    const detail = this.details.get(id);
    if (!detail) return;
    const item = protocol.threadItem.parse(raw);
    if (item.kind === 'synchronized') return;
    const sequence = item.kind === 'snapshot' ? item.snapshotSequence : item.sequence;
    if (sequence <= detail.sequence) return;
    detail.sequence = sequence;
    if (item.kind === 'snapshot') {
      detail.steps = [];
      delete detail.message;
      detail.approvals.clear();
      detail.requests.clear();
      for (const request of item.projection.runtimeRequests)
        if (request.status === 'pending') detail.requests.set(request.id, request);
      for (const raw of item.projection.turnItems) this.step(id, raw);
    } else if (item.kind === 'event') {
      if (item.event.type === 'turn-item.updated') this.step(id, item.event.payload);
      else if (item.event.type === 'runtime-request.updated') {
        const request = protocol.runtimeRequest.parse(item.event.payload);
        if (request.status === 'pending') detail.requests.set(request.id, request);
        else {
          detail.requests.delete(request.id);
          detail.approvals.delete(request.id);
        }
      } else return;
    } else return;
    this.project(id);
  }

  private step(id: string, raw: unknown) {
    const detail = this.details.get(id)!;
    const item = protocol.turnItem.parse(raw);
    if (item.runId !== detail.runId) return;
    if (item.type === 'assistant_message') {
      if (
        item.text !== undefined &&
        (!detail.message || item.updatedAt >= detail.message.updatedAt)
      )
        detail.message = { id: item.id, text: item.text, updatedAt: item.updatedAt };
      return;
    }
    if (item.type === 'approval_request' && item.requestId) {
      detail.approvals.set(item.requestId, item);
      return;
    }
    const types = ['command_execution', 'file_change', 'file_search', 'web_search', 'dynamic_tool'];
    if (!types.includes(item.type)) return;
    const thread = this.threads.get(id)!;
    const root = thread.worktreePath ?? this.projects.get(thread.projectId)?.workspaceRoot ?? '';
    const input = z
      .object({ command: z.string().optional(), file_path: z.string().optional() })
      .catch({})
      .parse(item.input);
    const activity =
      item.type === 'command_execution'
        ? codexActivity('Bash', { command: typeof item.input === 'string' ? item.input : '' }, root)
        : item.type === 'file_change'
          ? codexActivity('Edit', { file_path: item.fileName }, root)
          : item.type === 'file_search' || item.type === 'web_search'
            ? {
                activity: 'search' as const,
                label: item.type === 'file_search' ? 'Searching files' : 'Searching the web',
                detail: item.pattern ?? item.title ?? '',
              }
            : codexActivity(item.toolName ?? 'tool', input, root);
    const ended = ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status);
    const step: AgentStep = {
      id: item.id,
      ...activity,
      detail: activity.detail.slice(0, 4000),
      startedAt: item.startedAt ?? item.updatedAt,
      ...(ended
        ? {
            endedAt: item.completedAt ?? item.updatedAt,
            outcome:
              item.status === 'failed'
                ? 'failed'
                : item.status === 'completed'
                  ? 'completed'
                  : 'stopped',
          }
        : {}),
    };
    const index = detail.steps.findIndex((step) => step.id === item.id);
    if (index >= 0) detail.steps[index] = step;
    else detail.steps.push(step);
    detail.steps = detail.steps.slice(-8);
  }

  private project(id: string, publish = true) {
    const previous = this.agents.get(id),
      thread = this.threads.get(id),
      detail = this.details.get(id);
    if (!previous || !thread || !detail) return;
    const request = [...detail.requests.values()].find(
      (request) =>
        request.status === 'pending' &&
        request.responseCapability.type === 'live' &&
        detail.approvals.has(request.id),
    );
    const item = request && detail.approvals.get(request.id);
    const approval =
      item &&
      (!item.options ||
        ['accept', 'decline'].every((decision) =>
          item.options!.some((option) => option.decision === decision),
        ))
        ? {
            id: request!.id,
            label: item.prompt?.slice(0, 100) || item.title?.slice(0, 100) || 'Needs approval',
            detail: [item.prompt, item.reason].filter(Boolean).join('\n').slice(0, 4000),
            reason: item.reason,
            activity: 'tool' as const,
            startedAt: request!.createdAt,
          }
        : undefined;
    const status =
      approval || thread.pendingRuntimeRequest || thread.hasActionableProposedPlan
        ? 'needs-input'
        : thread.status === 'queued' && !thread.activityRunStatus
          ? 'queued'
          : thread.activityRunStatus ||
              ['preparing', 'queued', 'starting', 'running', 'waiting'].includes(thread.status)
            ? 'working'
            : thread.status === 'completed'
              ? 'done'
              : thread.status === 'idle'
                ? 'idle'
                : thread.status === 'failed'
                  ? 'failed'
                  : 'stopped';
    if (['done', 'failed', 'stopped'].includes(status))
      detail.steps = detail.steps.map((step) =>
        step.endedAt
          ? step
          : {
              ...step,
              endedAt: Math.max(thread.updatedAt, step.startedAt),
              outcome: status === 'failed' ? 'failed' : 'stopped',
            },
      );
    const agent: T3Agent = {
      ...previous,
      status,
      approval,
      message: detail.message?.text,
      steps: [...detail.steps],
    };
    this.agents.set(id, agent);
    if (publish) this.emit({ type: 't3.agent', agent });
  }

  private async target(input: { sessionId: string; agentId: string }) {
    const generation = this.generation;
    if (!this.integration.connected || !this.socket || this.closed)
      throw new Error('T3 is not connected.');
    const thread = this.threads.get(input.agentId);
    const path =
      thread?.worktreePath ?? (thread && this.projects.get(thread.projectId)?.workspaceRoot);
    if (path) this.paths.delete(path);
    for (const session of this.sessions()) this.paths.delete(session.path);
    await this.refresh([input.agentId]);
    if (generation !== this.generation || !this.socket || !this.integration.connected)
      throw new Error('T3 is not connected.');
    const agent = this.agents.get(input.agentId);
    if (!agent || agent.sessionId !== input.sessionId)
      throw new Error('This T3 conversation is no longer available in this worktree.');
    return { agent, socket: this.socket };
  }

  async queue(input: ParsedInput<'t3.queue'>) {
    const { agent, socket } = await this.target(input);
    await socket.command({
      type: 'message.dispatch',
      commandId: randomUUID(),
      threadId: agent.threadId,
      messageId: randomUUID(),
      text: input.message,
      attachments: [],
      createdBy: 'user',
      creationSource: 'web',
      dispatchMode: { type: 'queue_after_active' },
    });
    return { status: 'queued' as const };
  }

  async respond(input: ParsedInput<'t3.respond'>) {
    const { agent, socket } = await this.target(input);
    if (agent.approval?.id !== input.requestId)
      throw new Error('This T3 permission request is no longer waiting.');
    await socket.command({
      type: 'runtime-request.respond',
      commandId: randomUUID(),
      threadId: agent.threadId,
      requestId: input.requestId,
      decision: input.decision === 'allow' ? 'accept' : 'decline',
    });
    return null;
  }

  async close() {
    this.closed = true;
    this.stop();
    await this.ready;
    await this.changes;
  }
}
