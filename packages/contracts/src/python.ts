import { z } from 'zod';
import { id, path, text } from './schema';

const position = z.object({ line: z.number().int().min(0), character: z.number().int().min(0) });
const source = { sessionId: id, path, position };
const location = z.object({ uri: z.string().max(8192), position });

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
  'python.hover': z.object(source),
  'python.source': z.object({ ...source, target: location }),
} as const;

export type PythonLocation = z.infer<typeof location>;
export interface PythonSymbol extends PythonLocation {
  name: string;
  kind: number;
}
export interface PythonDefinition {
  module: PythonSymbol;
  containers: PythonSymbol[];
  symbol: PythonSymbol;
}
export interface PythonHover {
  markdown: string;
  range?: { start: PythonLocation['position']; end: PythonLocation['position'] };
  definitions: PythonDefinition[];
}
export interface PythonSource {
  text: string;
  path: string;
  workspacePath?: string;
}

export interface PythonResults {
  'lsp.open': null;
  'lsp.close': null;
  'lsp.request': any;
  'python.format': string;
  'python.hover': PythonHover | null;
  'python.source': PythonSource;
}
