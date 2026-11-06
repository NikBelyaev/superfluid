import { parentPort } from 'node:worker_threads';
import { spawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { GhosttyTerminalCore } from '@superfluid/ghostty/core';
import { command } from '../process/ProcessRunner';
import type { Run, TerminalFrame } from '@superfluid/contracts';

const port = parentPort!;

const theme = {
  foreground: { r: 24, g: 24, b: 27 },
  background: { r: 252, g: 252, b: 252 },
  cursor: { r: 38, g: 56, b: 78 },
};

type Entry = {
  run: Run;
  pty: IPty;
  core: GhosttyTerminalCore;
  timer?: ReturnType<typeof setTimeout>;
  waiting: boolean;
  dirty: boolean;
  sequence: number;
  full: boolean;
  frames: TerminalFrame[];
  chunk: number;
  killTimers: ReturnType<typeof setTimeout>[];
};

const terminals = new Map<string, Entry>();

let attached: string | null = null;

const event = (value: unknown) => port.postMessage({ event: value });

const runs = () => event({ type: 'runs', runs: [...terminals.values()].map((t) => t.run) });

async function descendants(pid: number) {
  const table = await command('ps', ['-axo', 'pid=,ppid='], {
    cwd: process.cwd(),
    timeout: 2000,
  }).catch(() => '');
  const result = new Set([pid]);
  const rows = table
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number));
  for (let n = 0; n < 32; n++) {
    let changed = false;
    for (const [p, pp] of rows)
      if (result.has(pp) && !result.has(p)) {
        result.add(p);
        changed = true;
      }
    if (!changed) break;
  }
  return [...result].reverse();
}

async function stop(t: Entry) {
  if (t.run.state !== 'running') return;
  const signal = async (sig: NodeJS.Signals) => {
    if (t.run.state !== 'running') return;
    for (const pid of await descendants(t.pty.pid)) {
      try {
        process.kill(pid, sig);
      } catch {}
    }
  };
  await signal('SIGINT');
  t.killTimers.push(
    setTimeout(() => void signal('SIGTERM'), 750),
    setTimeout(() => void signal('SIGKILL'), 1750),
  );
}

function schedule(t: Entry) {
  t.dirty = true;
  if (attached !== t.run.id || t.waiting || t.timer) return;
  t.timer = setTimeout(() => {
    t.timer = undefined;
    sendFrame(t);
  }, 24);
}

function sendFrame(t: Entry) {
  if (attached !== t.run.id || t.waiting || !t.dirty) return;
  t.dirty = false;
  t.waiting = true;
  const snapshot = t.core.snapshot(),
    { rowData, dirtyRows, ...header } = snapshot;
  const indexes = t.full ? rowData.map((_, i) => i) : [...dirtyRows];
  // One screen is retained; only one row batch crosses IPC before its acknowledgement.
  const sequence = ++t.sequence;
  const batches: [number, (typeof rowData)[number]][][] = [];
  let batch: [number, (typeof rowData)[number]][] = [];
  let size = 0;
  for (const index of indexes) {
    const row: [number, (typeof rowData)[number]] = [index, rowData[index]];
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (size + bytes > 48 * 1024 && batch.length) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(row);
    size += bytes;
  }
  batches.push(batch);
  t.frames = batches.map((rows, i) => ({
    id: t.run.id,
    sequence,
    chunk: i,
    full: t.full && i === 0,
    header,
    rows,
    last: i === batches.length - 1,
  }));
  t.chunk = 0;
  event({ type: 'terminal.frame', frame: t.frames[0] });
  t.full = false;
}

async function handle(method: string, input: any) {
  if (method === 'run') {
    if ([...terminals.values()].filter((t) => t.run.state === 'running').length >= 12)
      throw new Error('Twelve terminals are running. Stop one before starting another.');
    // Exited buffers are bounded too; an explicit new run releases the oldest completed buffer.
    if (terminals.size >= 16) {
      const old = [...terminals.values()].find((t) => t.run.state !== 'running');
      if (old) {
        old.core.dispose();
        terminals.delete(old.run.id);
      }
    }
    const id = randomUUID();
    let pty: IPty | undefined;
    const core = await GhosttyTerminalCore.create(90, 26, 8, 18, theme, (data) => pty?.write(data));
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      };
      delete env.ELECTRON_RUN_AS_NODE;
      pty = spawn(input.file, input.args, {
        name: 'xterm-256color',
        cols: 90,
        rows: 26,
        cwd: input.cwd,
        env,
      });
    } catch (e) {
      core.dispose();
      throw e;
    }
    const run: Run = {
      id,
      sessionId: input.sessionId,
      name: input.name,
      command: input.command,
      state: 'running',
      startedAt: Date.now(),
      previewUrl: input.previewUrl,
    };
    const t: Entry = {
      run,
      pty,
      core,
      waiting: false,
      dirty: true,
      sequence: 0,
      full: true,
      frames: [],
      chunk: 0,
      killTimers: [],
    };
    terminals.set(id, t);
    pty.onData((data) => {
      core.write(data);
      schedule(t);
    });
    pty.onExit(({ exitCode }) => {
      run.state = exitCode === 0 ? 'exited' : 'failed';
      run.exitCode = exitCode;
      for (const timer of t.killTimers) clearTimeout(timer);
      runs();
      schedule(t);
    });
    if (input.shellCommand) pty.write(input.shellCommand + '\r');
    runs();
    return run;
  }
  if (method === 'list') return [...terminals.values()].map((t) => t.run);
  if (method === 'shutdown') {
    for (const t of terminals.values()) await stop(t);
    await new Promise((r) => setTimeout(r, 1900));
    for (const t of terminals.values()) {
      try {
        t.pty.kill();
      } catch {}
      t.core.dispose();
    }
    terminals.clear();
    return null;
  }
  const t = terminals.get(input.id);
  if (!t) throw new Error('This terminal is no longer available.');
  switch (input.command) {
    case 'rename':
      if (typeof input.data !== 'string' || !input.data.trim() || input.data.length > 80)
        throw new Error('Use a terminal name with 1–80 characters.');
      t.run.name = input.data.trim();
      runs();
      break;
    case 'attach':
      attached = t.run.id;
      t.waiting = false;
      t.frames = [];
      t.full = true;
      schedule(t);
      break;
    case 'detach':
      if (attached === t.run.id) {
        attached = null;
        t.frames = [];
        t.waiting = false;
      }
      break;
    case 'ack':
      if (
        attached === t.run.id &&
        input.data?.sequence === t.sequence &&
        input.data?.chunk === t.chunk
      ) {
        if (t.chunk < t.frames.length - 1) {
          t.chunk++;
          event({ type: 'terminal.frame', frame: t.frames[t.chunk] });
        } else {
          t.frames = [];
          t.waiting = false;
          if (t.dirty) schedule(t);
        }
      }
      break;
    case 'resize': {
      const { cols, rows, cellWidth, cellHeight } = input.data;
      if (
        ![cols, rows, cellWidth, cellHeight].every(Number.isFinite) ||
        cols < 1 ||
        cols > 400 ||
        rows < 1 ||
        rows > 120 ||
        cellWidth < 1 ||
        cellWidth > 64 ||
        cellHeight < 1 ||
        cellHeight > 128
      )
        throw new Error('Unsupported terminal dimensions.');
      t.pty.resize(Math.floor(cols), Math.floor(rows));
      t.core.resize(Math.floor(cols), Math.floor(rows), cellWidth, cellHeight);
      t.full = true;
      schedule(t);
      break;
    }
    case 'text':
      if (typeof input.data !== 'string' || input.data.length > 1024 * 1024)
        throw new Error('Paste is too large.');
      t.pty.write(t.core.encodePaste(input.data));
      break;
    case 'key': {
      const data = input.data;
      if (
        typeof data?.key !== 'string' ||
        data.key.length > 64 ||
        typeof data.code !== 'string' ||
        data.code.length > 64
      )
        throw new Error('Invalid terminal key.');
      t.pty.write(
        t.core.encodeKey({
          ...data,
          getModifierState: (name: string) =>
            name === 'CapsLock' ? !!data.capsLock : name === 'NumLock' ? !!data.numLock : false,
        } as KeyboardEvent),
      );
      break;
    }
    case 'scroll':
      if (!Number.isFinite(input.data)) throw new Error('Invalid scroll.');
      t.core.scroll(Math.max(-5000, Math.min(5000, Math.round(input.data))));
      t.full = true;
      schedule(t);
      break;
    case 'select': {
      const d = input.data;
      if (
        !d ||
        ![d.start?.x, d.start?.y, d.end?.x, d.end?.y].every(
          (n) => Number.isInteger(n) && n >= 0 && n < 5000,
        )
      )
        throw new Error('Invalid terminal selection.');
      t.core.setSelection(d.start, d.end);
      schedule(t);
      break;
    }
    case 'copy':
      return t.core.selectionText();
    case 'stop':
      await stop(t);
      break;
    default:
      throw new Error('Unknown terminal command.');
  }
  return null;
}

port.on('message', async (message) => {
  try {
    const result = await handle(message.method, message.input);
    port.postMessage({ id: message.id, result });
  } catch (e: any) {
    port.postMessage({ id: message.id, error: e.message });
  }
});
