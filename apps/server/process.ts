import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
const children = new Map<ChildProcess, Promise<void>>();
let stopping = false;
function signal(child: ChildProcess, value: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, value);
  } catch {}
}
export async function stopCommands() {
  stopping = true;
  const entries = [...children];
  for (const [child] of entries) signal(child, 'SIGTERM');
  const timer = setTimeout(() => {
    for (const [child] of children) signal(child, 'SIGKILL');
  }, 1000);
  try {
    await Promise.all(entries.map(([, closed]) => closed));
  } finally {
    clearTimeout(timer);
  }
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stdout: string,
  ) {
    super(message);
  }
}

export async function command(
  file: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    timeout?: number;
    limit?: number;
    accept?: number[];
    env?: NodeJS.ProcessEnv;
  },
): Promise<string> {
  if (stopping) throw new Error('Superfluid is closing. No new processes can start.');
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    children.set(
      child,
      new Promise<void>((resolve) =>
        child.once('close', () => {
          children.delete(child);
          resolve();
        }),
      ),
    );
    const stdoutDecoder = new StringDecoder('utf8'),
      stderrDecoder = new StringDecoder('utf8');
    let out = '',
      err = '',
      bytes = 0,
      failed: Error | undefined;
    const kill = () => signal(child, 'SIGTERM');
    const timer = setTimeout(() => {
      failed = new Error(`${file} timed out. Check the process or connection and retry.`);
      kill();
      escalation = setTimeout(() => {
        try {
          process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGKILL');
        } catch {}
      }, 1000);
    }, options.timeout ?? 15000);
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const collect = (data: Buffer, stderr: boolean) => {
      bytes += data.length;
      if (bytes > (options.limit ?? 4 * 1024 * 1024)) {
        if (!failed) {
          failed = new Error(`${file} returned too much data. Narrow the selection.`);
          kill();
          escalation = setTimeout(() => signal(child, 'SIGKILL'), 1000);
        }
        return;
      }
      if (stderr) err += stderrDecoder.write(data);
      else out += stdoutDecoder.write(data);
    };
    child.stdout.on('data', (b) => collect(b, false));
    child.stderr.on('data', (b) => collect(b, true));
    child.on('error', (e) => {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      reject(e);
    });
    child.on('close', (code) => {
      out += stdoutDecoder.end();
      err += stderrDecoder.end();
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      if (failed) reject(failed);
      else if (code !== 0 && !options.accept?.includes(code ?? -1))
        reject(new ProcessError(err.trim() || `${file} exited with code ${code}`, code, out));
      else resolve(out);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
}

export class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private cap: number,
    private pending = 16,
  ) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.cap) {
      if (this.waiting.length >= this.pending)
        throw new Error('This queue is full. Wait for a running operation to finish.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export const git = (
  cwd: string,
  args: string[],
  options: Partial<Parameters<typeof command>[2]> = {},
) => command('git', args, { cwd, ...options });
export function safeRef(ref: string) {
  if (!ref || ref.startsWith('-') || /[\x00-\x20]/.test(ref))
    throw new Error('Choose a valid Git reference.');
  return ref;
}
