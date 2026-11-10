import { z } from 'zod';
import { id } from '../schema';

export type {
  AgentActivity as CodexActivity,
  AgentStep as CodexStep,
  Agent as CodexAgent,
} from './activity';

export interface CodexIntegration {
  enabled: boolean;
  configPath: string;
  error?: string;
}

export const codexRequests = {
  'codex.status': z.object({}),
  'codex.configure': z.object({ enabled: z.boolean() }),
  'codex.queue': z.object({
    sessionId: id,
    agentId: id,
    message: z
      .string()
      .min(1)
      .max(16000)
      .refine((value) => !!value.trim() && !value.includes('\0')),
  }),
  'codex.respond': z.object({
    sessionId: id,
    agentId: id,
    requestId: id,
    decision: z.enum(['allow', 'deny']),
  }),
} as const;

export interface CodexResults {
  'codex.status': CodexIntegration;
  'codex.configure': CodexIntegration;
  'codex.queue': { status: 'queued' };
  'codex.respond': null;
}
