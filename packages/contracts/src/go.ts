import { z } from 'zod';
import { id, path, text } from './schema';

const goPath = path.refine((value) => value.endsWith('.go'));
const version = z.number().int().min(0).max(2147483647);
const position = z.object({ line: z.number().int().min(0), character: z.number().int().min(0) });
export const goRange = z.object({ start: position, end: position });
export type GoRange = z.infer<typeof goRange>;
export const goDiagnostic = z.object({
  range: goRange,
  message: text,
  severity: z.number().int().min(1).max(4).optional(),
  source: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
});
const edit = z.object({ range: goRange, newText: text });
const markup = z.object({ kind: z.enum(['markdown', 'plaintext']), value: text });
export const goCompletion = z.object({
  label: z.string(),
  kind: z.number().int().min(1).max(25).optional(),
  detail: z.string().optional(),
  documentation: z.union([text, markup]).optional(),
  filterText: z.string().optional(),
  sortText: z.string().optional(),
  insertText: z.string().optional(),
  insertTextFormat: z.number().optional(),
  textEdit: z
    .union([edit, z.object({ insert: goRange, replace: goRange, newText: text })])
    .optional(),
  additionalTextEdits: z.array(edit).max(100).optional(),
});
export const goHover = z.object({ contents: markup, range: goRange.optional() });

const document = { sessionId: id, path: goPath };
const query = z.object({
  ...document,
  position,
  generation: z.number().int().positive(),
  requestId: id,
});
export const goRequests = {
  'go.packageStatus': z.object({}),
  'go.install': z.object({}),
  'go.remove': z.object({}),
  'go.sync': z.object({ ...document, text, version }),
  'go.close': z.object(document),
  'go.cancel': z.object({ sessionId: id, requestId: id }),
  'go.completion': query,
  'go.hover': query,
  'go.definition': query,
} as const;

export interface GoResults {
  'go.packageStatus': GoPackageStatus;
  'go.install': null;
  'go.remove': null;
  'go.sync': number;
  'go.close': null;
  'go.cancel': null;
  'go.completion': { items: z.infer<typeof goCompletion>[]; isIncomplete: boolean };
  'go.hover': z.infer<typeof goHover> | null;
  'go.definition': { path: string; range: z.infer<typeof goRange> }[];
}

export interface GoPackageStatus {
  source: 'managed' | 'external' | 'missing';
  goAvailable: boolean;
  operation: 'installing' | 'removing' | null;
  progress?: GoInstallProgress;
  error?: string;
}

export type GoInstallProgress =
  { stage: 'downloading-go'; percent?: number } | { stage: 'unpacking-go' | 'installing-gopls' };

export interface GoStatus {
  type: 'lsp.status';
  sessionId: string;
  generation: number;
  server: 'gopls';
  phase: 'starting' | 'ready' | 'stopped' | 'error';
  status: string;
  needsInstallation?: true;
}
