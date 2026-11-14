import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppEvent, ParsedInput, TerminalServer } from '@superfluid/contracts';
import { command } from '../process/ProcessRunner';

type TerminalProcess = { terminalId: string; sessionId: string; pid: number; previewUrl?: string };

export function serverSnapshot(
  processText: string,
  listenerText: string,
  terminals: TerminalProcess[],
) {
  const processes = new Map<number, { pid: number; parent: number; group: number; name: string }>();
  for (const line of processText.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match)
      processes.set(Number(match[1]), {
        pid: Number(match[1]),
        parent: Number(match[2]),
        group: Number(match[3]),
        name: match[4].trim(),
      });
  }
  const roots = new Map(terminals.map((terminal) => [terminal.pid, terminal]));
  const owners = new Map<number, TerminalProcess>();
  for (const pid of processes.keys()) {
    const seen = new Set<number>();
    let parent = pid;
    while (parent > 0 && !seen.has(parent)) {
      const owner = roots.get(parent);
      if (owner) {
        owners.set(pid, owner);
        break;
      }
      seen.add(parent);
      parent = processes.get(parent)?.parent ?? 0;
    }
  }
  const servers = new Map<string, TerminalServer>();
  let pid = 0;
  let name = '';
  for (const line of listenerText.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
      name = '';
    } else if (line.startsWith('c')) name = line.slice(1).trim();
    else if (line.startsWith('n')) {
      const address = line.slice(1).trim();
      const colon = address.lastIndexOf(':');
      const host = address.slice(0, colon).replace(/^\[|\]$/g, '');
      const port = Number(address.slice(colon + 1));
      const owner = owners.get(pid);
      if (
        !owner ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        !(
          ['*', '0.0.0.0', '::', '::1', 'localhost'].includes(host) ||
          /^127(?:\.\d{1,3}){3}$/.test(host)
        )
      )
        continue;
      let url = `http://localhost:${port}`;
      try {
        const preview = new URL(owner.previewUrl || '');
        if (
          ['http:', 'https:'].includes(preview.protocol) &&
          ['localhost', '127.0.0.1', '[::1]'].includes(preview.hostname) &&
          Number(preview.port || (preview.protocol === 'https:' ? 443 : 80)) === port
        )
          url = preview.href;
      } catch {}
      servers.set(`${pid}:${port}`, {
        sessionId: owner.sessionId,
        terminalId: owner.terminalId,
        pid,
        port,
        name: name || basename(processes.get(pid)?.name || 'Server'),
        url,
      });
    }
  }
  return {
    processes,
    owners,
    servers: [...servers.values()].sort((a, b) => a.port - b.port || a.pid - b.pid),
  };
}

type Snapshot = ReturnType<typeof serverSnapshot>;

export function serverSignalTargets(snapshot: Snapshot, server: TerminalServer) {
  const target = snapshot.processes.get(server.pid);
  const owner = snapshot.owners.get(server.pid);
  if (
    !target ||
    !owner ||
    owner.terminalId !== server.terminalId ||
    owner.sessionId !== server.sessionId
  )
    return [];
  const group = [...snapshot.processes.values()].filter((row) => row.group === target.group);
  if (
    target.group > 1 &&
    group.every((row) => {
      const peer = snapshot.owners.get(row.pid);
      return (
        row.pid !== process.pid &&
        peer?.terminalId === owner.terminalId &&
        (row.pid !== owner.pid || row.pid === server.pid)
      );
    })
  )
    return [-target.group];
  const targets = new Set([server.pid]);
  for (let pass = 0; pass < snapshot.processes.size; pass++) {
    const size = targets.size;
    for (const row of snapshot.processes.values())
      if (targets.has(row.parent) && snapshot.owners.get(row.pid)?.terminalId === owner.terminalId)
        targets.add(row.pid);
    if (targets.size === size) break;
  }
  return [...targets]
    .reverse()
    .filter((pid) => pid !== process.pid && (pid !== owner.pid || pid === server.pid));
}

export class TerminalServers {
  private timer?: ReturnType<typeof setTimeout>;
  private reading?: Promise<Snapshot>;
  private closed = false;
  private failed = false;
  private previous = '[]';
  constructor(
    private terminals: () => TerminalProcess[],
    private notify: (event: AppEvent) => void,
  ) {}

  start() {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh()
        .catch((error) => {
          if (!this.failed && !this.closed)
            this.notify({
              type: 'error',
              message: `Local server discovery failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          this.failed = true;
        })
        .finally(() => {
          if (this.terminals().length) this.start();
        });
    }, 3000);
  }

  private async scan() {
    if (!this.terminals().length || this.closed) return serverSnapshot('', '', []);
    // shortcut: POSIX discovery uses lsof; add a Windows adapter when Windows desktop builds ship.
    const processes = await command('ps', ['-axo', 'pid=,ppid=,pgid=,comm='], {
      cwd: process.cwd(),
      timeout: 2000,
    });
    const owned = serverSnapshot(processes, '', this.terminals());
    if (!owned.owners.size) return owned;
    const listeners = await command(
      process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof',
      ['-a', '-p', [...owned.owners.keys()].join(','), '-iTCP', '-sTCP:LISTEN', '-nP', '-F', 'pcn'],
      { cwd: process.cwd(), timeout: 5000, accept: [1] },
    );
    return serverSnapshot(processes, listeners, this.terminals());
  }

  private read() {
    return (this.reading ??= this.scan().finally(() => {
      this.reading = undefined;
    }));
  }

  async refresh() {
    const snapshot = await this.read();
    const serialized = JSON.stringify(snapshot.servers);
    if (!this.closed && serialized !== this.previous) {
      this.previous = serialized;
      this.notify({ type: 'servers', servers: snapshot.servers });
    }
    this.failed = false;
    return snapshot;
  }

  async stop(input: ParsedInput<'terminal.server.stop'>) {
    await this.reading;
    let snapshot = await this.refresh();
    const server = snapshot.servers.find(
      (server) =>
        server.pid === input.pid &&
        server.port === input.port &&
        server.terminalId === input.terminalId &&
        server.sessionId === input.sessionId,
    );
    if (!server) throw new Error('This server is no longer available in this session.');
    const root = snapshot.owners.get(server.pid)!;
    const original = snapshot.processes.get(server.pid)!;
    const alive = (current: Snapshot) => {
      const process = current.processes.get(server.pid);
      return (
        current.owners.get(server.pid)?.pid === root.pid &&
        process?.name === original.name &&
        process.group === original.group
      );
    };
    const signal = (value: NodeJS.Signals) => {
      if (this.closed) return;
      for (const target of serverSignalTargets(snapshot, server)) {
        try {
          process.kill(target, value);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
        }
      }
    };
    signal('SIGTERM');
    const deadline = Date.now() + 1500;
    do {
      await delay(100);
      snapshot = await this.refresh();
      if (!alive(snapshot) || this.closed) return null;
    } while (Date.now() < deadline);
    signal('SIGKILL');
    await delay(100);
    snapshot = await this.refresh();
    if (alive(snapshot)) throw new Error('The server did not stop. Try again.');
    return null;
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    await this.reading?.catch(() => {});
  }
}
