import { z } from 'zod';
import type { GhosttySnapshot, GhosttyRow } from '@superfluid/ghostty/core';
import { id, path } from './schema';

const terminalColor = z.object({
  r: z.int().min(0).max(255),
  g: z.int().min(0).max(255),
  b: z.int().min(0).max(255),
});
export const terminalThemeSchema = z.object({
  foreground: terminalColor,
  background: terminalColor,
  cursor: terminalColor,
});

export const actionSchema = z.object({
  id: id.optional(),
  projectId: id,
  name: z.string().min(1).max(80),
  kind: z.enum(['shell', 'python', 'django']),
  command: z.string().min(1).max(8192),
  cwd: path.default(''),
  shortcut: z.string().max(80).default(''),
  previewUrl: z.string().max(2048).default(''),
});

export type Action = z.output<typeof actionSchema> & { id: string };

export interface Run {
  id: string;
  sessionId: string;
  name: string;
  command: string;
  state: 'starting' | 'running' | 'exited' | 'failed';
  exitCode?: number;
  startedAt: number;
  previewUrl?: string;
}

export interface TerminalServer {
  sessionId: string;
  terminalId: string;
  pid: number;
  port: number;
  name: string;
  url: string;
}

export type TerminalFrame = {
  id: string;
  sequence: number;
  chunk: number;
  full: boolean;
  header: Omit<GhosttySnapshot, 'rowData' | 'dirtyRows'>;
  rows: [number, GhosttyRow][];
  last: boolean;
};

export const terminalRequests = {
  'actions.save': actionSchema,
  'actions.delete': z.object({ id }),
  'terminal.server.stop': z.object({
    sessionId: id,
    terminalId: id,
    pid: z.int().positive(),
    port: z.int().min(1).max(65535),
  }),
  'terminal.run': z.object({
    sessionId: id,
    actionId: id.optional(),
    name: z.string().max(80).default('Terminal'),
    command: z.string().max(8192).default(''),
  }),
  'terminal.command': z.object({
    id,
    command: z.enum([
      'attach',
      'detach',
      'ack',
      'resize',
      'key',
      'text',
      'stop',
      'scroll',
      'select',
      'copy',
      'rename',
      'theme',
    ]),
    data: z.unknown().optional(),
  }),
} as const;

export interface TerminalResults {
  'actions.save': Action;
  'actions.delete': null;
  'terminal.server.stop': null;
  'terminal.run': Run;
  'terminal.command': any;
}
