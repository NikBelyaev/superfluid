import { z } from 'zod';
import { isAbsolute } from 'node:path';

const text = z.string().max(8192);
const id = z.string().min(1).max(256);
const sequence = z.number().int().nonnegative();
const date = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value : Date.parse(value)))
  .refine(Number.isFinite);
const path = text.refine(isAbsolute);

export function localOrigin(raw: string) {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Use a pairing link for T3 running on this computer.');
  return url.origin;
}

export function pairing(raw: string) {
  let url = new URL(raw);
  if (url.username || url.password)
    throw new Error('Use a T3 pairing link without embedded credentials.');
  if (
    /^t3code(?:-[a-z]+)?:$/.test(url.protocol) &&
    url.host === 'pair' &&
    (url.pathname === '' || url.pathname === '/')
  ) {
    const pairingUrl = url.searchParams.get('pairingUrl')?.trim();
    if (!pairingUrl) throw new Error('Paste a complete T3 pairing link.');
    url = new URL(pairingUrl);
  }
  if (url.username || url.password)
    throw new Error('Use a T3 pairing link without embedded credentials.');
  const desktop =
    /^t3code(?:-[a-z]+)?:$/.test(url.protocol) && url.host === 'app' && url.pathname === '/pair';
  if (!['http:', 'https:'].includes(url.protocol) && !desktop)
    throw new Error('Paste a pairing link copied from T3 Code.');
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  if (!token || token.length > 4096) throw new Error('Paste a complete T3 pairing link.');
  if (desktop)
    return {
      origin: undefined,
      token,
      profile: url.protocol === 't3code-dev:' ? 'dev' : 'userdata',
    };
  return { origin: localOrigin(url.searchParams.get('host') ?? url.href), token };
}

export const environment = z.object({
  environmentId: id,
  orchestrationProtocolVersion: z.literal(2),
});
export const credentials = z.object({
  origin: text.transform(localOrigin),
  token: z.string().min(1).max(8192),
  environmentId: id,
});
export const accessToken = z.object({
  access_token: z.string().min(1).max(8192),
  token_type: z.literal('Bearer'),
  scope: z.string(),
});
export const ticket = z.object({ ticket: z.string().min(1).max(8192) });
export const project = z.object({ id, workspaceRoot: path });
export const thread = z.object({
  id,
  projectId: id,
  title: text,
  modelSelection: z.object({ model: text }),
  worktreePath: path.nullable(),
  status: text,
  latestRunId: id.nullable(),
  activeRunId: id.nullable(),
  latestRunStartedAt: date.nullish(),
  latestRunRequestedAt: date.nullish(),
  activityRunStatus: text.nullish(),
  pendingRuntimeRequest: z.object({ id, kind: text, blocking: z.boolean().optional() }).nullable(),
  hasActionableProposedPlan: z.boolean(),
  createdAt: date,
  updatedAt: date,
  archivedAt: date.nullable(),
  settledOverride: z.enum(['settled', 'active']).nullable(),
  settledAt: date.nullable(),
  deletedAt: date.nullable(),
});
export const shellItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('snapshot'),
    resolvedRepositoryIdentityRoots: z.array(z.string()).optional(),
    snapshot: z.object({
      snapshotSequence: sequence,
      projects: z.array(project).max(10000),
      threads: z.array(thread).max(10000),
    }),
  }),
  z.object({ kind: z.literal('project.updated'), sequence, project }),
  z.object({ kind: z.literal('project.removed'), sequence, projectId: id }),
  z.object({
    kind: z.literal('thread.updated'),
    sequence,
    location: z.enum(['active', 'archive']),
    thread,
  }),
  z.object({ kind: z.literal('thread.removed'), sequence, threadId: id }),
  z.object({ kind: z.literal('synchronized') }),
]);
export const turnItem = z.object({
  id: text.min(1),
  runId: id.nullable(),
  type: text,
  status: text,
  title: text.nullable(),
  startedAt: date.nullable(),
  completedAt: date.nullable(),
  updatedAt: date,
  input: z.unknown().optional(),
  toolName: text.nullish(),
  fileName: text.optional(),
  pattern: text.optional(),
  requestId: id.optional(),
  prompt: text.optional(),
  reason: text.optional(),
  text: z
    .string()
    .transform((value) => value.slice(0, 32768))
    .optional(),
  options: z.array(z.object({ decision: text })).optional(),
});
export const runtimeRequest = z.object({
  id,
  kind: text,
  status: text,
  responseCapability: z.object({ type: text }),
  createdAt: date,
});
export const threadItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('snapshot'),
    snapshotSequence: sequence,
    projection: z.object({
      turnItems: z.array(z.unknown()),
      runtimeRequests: z.array(runtimeRequest),
    }),
  }),
  z.object({
    kind: z.literal('event'),
    sequence,
    event: z.object({ type: text, payload: z.unknown() }),
  }),
  z.object({ kind: z.literal('synchronized') }),
]);

export type T3Thread = z.infer<typeof thread>;
export type T3TurnItem = z.infer<typeof turnItem>;
export type T3RuntimeRequest = z.infer<typeof runtimeRequest>;
