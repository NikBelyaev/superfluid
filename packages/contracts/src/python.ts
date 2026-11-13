import { z } from 'zod';
import { id, path, text } from './schema';
import type { SearchHit } from './files';

const position = z.object({ line: z.number().int().min(0), character: z.number().int().min(0) });
const source = { sessionId: id, path, position };
const requestId = id.optional();
const location = z.object({ uri: z.string().max(8192), position });

export const pythonRequests = {
  'lsp.open': z.object({ sessionId: id, path, text, version: z.number().int().min(0) }),
  'lsp.close': z.object({ sessionId: id, path }),
  'lsp.cancel': z.object({ sessionId: id, requestId: id }),
  'lsp.request': z.object({
    sessionId: id,
    requestId,
    method: z.enum([
      'textDocument/completion',
      'completionItem/resolve',
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
  'python.organizeImports': z.object({ sessionId: id, path, text }),
  'python.imports': z.object({ ...source, text, version: z.number().int().min(0), requestId }),
  'python.symbols': z.object({ sessionId: id, query: z.string().max(500), requestId }),
  'python.hover': z.object({ ...source, requestId }),
  'python.source': z.object({ ...source, requestId, target: location }),
} as const;

export type PythonLocation = z.infer<typeof location>;
export interface PythonSymbol extends PythonLocation {
  name: string;
  kind: number;
  range?: { start: PythonLocation['position']; end: PythonLocation['position'] };
}
export interface PythonDefinition {
  module: PythonSymbol;
  containers: PythonSymbol[];
  symbol: PythonSymbol;
  // The server exposes the containing scope; append the hovered name for this binding.
  binding?: boolean;
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
  symbols?: PythonDocumentSymbol[];
}
export interface PythonDocumentSymbol {
  name: string;
  kind: number;
  range: { start: PythonLocation['position']; end: PythonLocation['position'] };
  children?: PythonDocumentSymbol[];
}

export interface PythonUnusedImport {
  range: { start: PythonLocation['position']; end: PythonLocation['position'] };
  message: string;
}

export interface PythonImport {
  title: string;
  edits: { range: PythonUnusedImport['range']; newText: string }[];
}

export interface PythonResult<T> {
  generation: number;
  value: T;
}

export interface PythonStatus {
  type: 'lsp.status';
  sessionId: string;
  generation: number;
  server?: 'ty' | 'pyright';
  phase: 'starting' | 'ready' | 'stopped' | 'error';
  status: string;
}

export interface PythonResults {
  'lsp.open': PythonResult<PythonUnusedImport[]>;
  'lsp.close': null;
  'lsp.cancel': null;
  'lsp.request': PythonResult<any>;
  'python.format': string;
  'python.organizeImports': string;
  'python.imports': PythonResult<PythonImport[]>;
  'python.symbols': PythonResult<{ hits: SearchHit[]; truncated: boolean }>;
  'python.hover': PythonResult<PythonHover | null>;
  'python.source': PythonResult<PythonSource>;
}
