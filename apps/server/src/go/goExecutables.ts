import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

const suffix = process.platform === 'win32' ? '.exe' : '';

export const goplsName = `gopls${suffix}`;
export const managedGopls = (directory: string) => join(directory, 'tools', goplsName);
export const managedGo = (directory: string) => join(directory, 'tools', 'go');

export function goEnvironment(directory?: string) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const goPath = env.GOPATH?.split(delimiter)[0] || join(homedir(), 'go');
  env.PATH = [
    env.PATH,
    env.GOBIN || join(goPath, 'bin'),
    env.GOROOT ? join(env.GOROOT, 'bin') : undefined,
    process.platform === 'darwin' ? '/usr/local/go/bin' : undefined,
    directory ? join(managedGo(directory), 'bin') : undefined,
  ]
    .filter(Boolean)
    .join(delimiter);
  return env;
}

export async function findGoTool(name: string, env: NodeJS.ProcessEnv) {
  const candidates = isAbsolute(name)
    ? [name]
    : (env.PATH ?? '')
        .split(delimiter)
        .filter(isAbsolute)
        .map((directory) => join(directory, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
}

export const goName = `go${suffix}`;

export async function goRuntime(directory: string) {
  const env = goEnvironment(directory);
  const file = await findGoTool(goName, env);
  if (!file) return;
  return {
    file,
    env: {
      PATH: env.PATH,
      GOROOT: file === join(managedGo(directory), 'bin', goName) ? undefined : env.GOROOT,
    },
  };
}
