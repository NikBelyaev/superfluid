import { z } from 'zod';
import { codexRequests } from './codex';
import type { Agent } from './activity';

export interface T3Agent extends Agent {
  title: string;
  url: string;
}

export interface T3Integration {
  enabled: boolean;
  connected: boolean;
  origin?: string;
  error?: string;
}

export const t3Requests = {
  't3.status': z.object({}),
  't3.connect': z.object({ pairingLink: z.string().trim().min(1).max(8192) }),
  't3.disconnect': z.object({}),
  't3.queue': codexRequests['codex.queue'],
  't3.respond': codexRequests['codex.respond'],
} as const;

export interface T3Results {
  't3.status': T3Integration;
  't3.connect': T3Integration;
  't3.disconnect': T3Integration;
  't3.queue': { status: 'queued' };
  't3.respond': null;
}
