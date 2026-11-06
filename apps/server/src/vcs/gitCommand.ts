import { command } from '../process/ProcessRunner';

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
