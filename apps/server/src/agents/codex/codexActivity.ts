import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CodexActivity } from '@superfluid/contracts';

export function codexChangedFiles(
  tool: string,
  input: { command?: string; file_path?: string },
  root: string,
  cwd: string,
  originalCwd: string,
) {
  const files =
    tool === 'apply_patch'
      ? [
          ...(input.command ?? '').matchAll(
            /^\*\*\* (?:(?:Update|Add|Delete) File|Move to): (.+)$/gm,
          ),
        ].map((match) => match[1])
      : (tool === 'Edit' || tool === 'Write') && input.file_path
        ? [input.file_path]
        : [];
  return files.flatMap((file) => {
    const canonical = relative(root, resolve(cwd, file));
    const source =
      isAbsolute(file) && (canonical === '..' || canonical.startsWith('..' + sep))
        ? relative(originalCwd, file)
        : file;
    const path = relative(root, resolve(cwd, source));
    return path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path) ? [path] : [];
  });
}

export function codexToolLabel(tool: string) {
  const name = (tool.split('__').at(-1) ?? tool)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => (word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(' ');
  return name ? name[0].toUpperCase() + name.slice(1) : 'Tool';
}

export function codexActivity(
  tool: string,
  input: { command?: string; file_path?: string },
  root: string,
) {
  const command = input.command ?? '';
  let activity: CodexActivity = 'command';
  let label = 'Running command';
  let detail = command || tool;
  if (tool === 'apply_patch' || tool === 'Edit' || tool === 'Write') {
    activity = 'edit';
    label = 'Editing files';
    const file = input.file_path ?? /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(command)?.[1];
    if (file) {
      const path = relative(root, resolve(root, file));
      if (path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
        label = `Editing ${path}`;
    }
    detail = label === 'Editing files' ? tool : label.slice(8);
  } else if (
    /^(?:Read|read_file)$/i.test(tool) ||
    /(?:^|[\s;&|/])(?:cat|sed|head|tail|less)\s/.test(command)
  ) {
    activity = 'read';
    label = 'Reading files';
    detail = input.file_path ?? detail;
  } else if (
    /^(?:Glob|Grep|search|file_search)$/i.test(tool) ||
    /(?:^|[\s;&|/])(?:rg|grep|find|ls)\s/.test(command)
  ) {
    activity = 'search';
    label = 'Searching files';
  } else if (
    /(?:^|[\s;&|/])(?:pytest|vitest|jest|playwright)(?:\s|$)|\b(?:npm|pnpm|yarn|cargo|go)\s+(?:run\s+)?test\b|\bpython\S*\s+-m\s+(?:pytest|unittest)\b|\bnode\s+--test\b/.test(
      command,
    )
  ) {
    activity = 'test';
    label = 'Running tests';
  } else if (tool === 'update_plan') {
    activity = 'thinking';
    label = 'Updating plan';
  } else if (tool !== 'Bash' && tool !== 'exec_command' && tool !== 'shell_command') {
    activity = 'tool';
    label = codexToolLabel(tool);
  }
  return { activity, label, detail: detail.slice(0, 4096) };
}
