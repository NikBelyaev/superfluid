import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { command } from '../process/ProcessRunner';

const interpreter = z.object({
  executable: z.string().min(1),
  version: z.tuple([z.number().int().min(3), z.number().int().min(0)]),
});

export async function inspectInterpreter(python: string, cwd: string) {
  if (!isAbsolute(python) && python !== 'python' && python !== 'python3')
    throw new Error('Choose an absolute interpreter path.');
  try {
    const output = await command(
      python,
      [
        '-I',
        '-c',
        'import json, sys; print(json.dumps({"executable": sys.executable, "version": list(sys.version_info[:2])}))',
      ],
      { cwd, timeout: 5000, limit: 8192 },
    );
    return interpreter.parse(JSON.parse(output));
  } catch (error) {
    throw new Error(
      `Could not use Python interpreter ${python}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function languageServerFor([major, minor]: [number, number]) {
  return major > 3 || (major === 3 && minor >= 10) ? 'ty' : 'pyright';
}
