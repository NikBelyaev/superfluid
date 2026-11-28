import { lstat, open } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { within } from '../files/paths';

const applicationDirectory = /^cmd\/(?![._])[^/]+$/;
const platformSuffix =
  /_(?:aix|android|darwin|dragonfly|freebsd|illumos|ios|js|linux|netbsd|openbsd|plan9|solaris|wasip1|windows|386|amd64|arm|arm64|loong64|mips(?:le|64|64le)?|ppc64(?:le)?|riscv64|s390x|wasm)\.go$/;
const goLiteralOrComment =
  /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|`[^`]*`|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'/g;
const maxSourceSize = 256 * 1024;

async function hasMain(root: string, path: string) {
  const file = await within(root, path);
  if (!(await lstat(file)).isFile()) return false;
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > maxSourceSize) return;
    const code = await handle.readFile('utf8');
    if (Buffer.byteLength(code) > maxSourceSize) return;
    const source = code.replace(goLiteralOrComment, (match) => match.replace(/[^\r\n]/g, ' '));
    const declaration = /^\s*package\s+main\b/.exec(source);
    if (!declaration || !/\bfunc\s+main\s*\(\s*\)\s*\{/.test(source)) return false;
    const header = code.slice(0, declaration[0].length);
    return platformSuffix.test(path) || /^[\t ]*\/\/(?:go:build\b| \+build\b)/m.test(header)
      ? 'conditional'
      : 'portable';
  } finally {
    await handle.close();
  }
}

export async function goDefaultAction(root: string, files: string[]) {
  if (
    !files.includes('go.mod') ||
    files.includes('go.work') ||
    files.some((path) => path.endsWith('/go.mod')) ||
    !(await lstat(join(root, 'go.mod')).catch(() => undefined))?.isFile()
  )
    return;

  const candidates = files.filter(
    (path) => /^(?![._]).+\.go$/.test(basename(path)) && !path.endsWith('_test.go'),
  );
  if (candidates.length > 256) return;
  let target: string | undefined;
  let portable = false;
  for (const path of candidates) {
    const entry = await hasMain(root, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (entry === undefined) return;
    if (entry) {
      const directory = dirname(path);
      if (target !== undefined && target !== directory) return;
      if (entry === 'portable' && portable) return;
      target = directory;
      portable ||= entry === 'portable';
    }
  }
  if (portable && target !== undefined && (target === '.' || applicationDirectory.test(target)))
    return {
      kind: 'go',
      name: 'Run Go app',
      command: 'go run .',
      cwd: target === '.' ? '' : target,
    } as const;
}
