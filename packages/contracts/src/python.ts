import { z } from 'zod';
import { id, path, text } from './schema';

export const pythonRequests = {
  'lsp.open': z.object({ sessionId: id, path, text, version: z.number().int().min(0) }),
  'lsp.close': z.object({ sessionId: id, path }),
  'lsp.request': z.object({
    sessionId: id,
    method: z.enum([
      'textDocument/completion',
      'textDocument/hover',
      'textDocument/definition',
      'textDocument/typeDefinition',
      'textDocument/implementation',
      'textDocument/references',
      'textDocument/documentSymbol',
      'textDocument/rename',
      'textDocument/prepareRename',
    ]),
    params: z.record(z.string(), z.unknown()),
  }),
  'python.format': z.object({ sessionId: id, text }),
} as const;

export interface PythonResults {
  'lsp.open': null;
  'lsp.close': null;
  'lsp.request': any;
  'python.format': string;
}
