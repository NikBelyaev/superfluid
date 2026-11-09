import { z } from 'zod';
import { id, path, text } from './schema';

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}

export interface DocumentData {
  path: string;
  text: string;
  hash: string;
  diskText?: string;
  recovered?: boolean;
  version: number;
}

export interface Draft {
  sessionId: string;
  path: string;
  text: string;
  hash: string;
  version: number;
  updatedAt: number;
}

export interface SearchHit {
  path: string;
  line?: number;
  column?: number;
  text?: string;
  name?: string;
  containerName?: string;
  kind?: number;
}

export const filesRequests = {
  'files.list': z.object({ sessionId: id, path: path.default('') }),
  'files.read': z.object({ sessionId: id, path, diskOnly: z.boolean().default(false) }),
  'files.save': z.object({ sessionId: id, path, text, hash: z.string().max(128) }),
  'files.create': z.object({ sessionId: id, path, directory: z.boolean().default(false) }),
  'files.rename': z.object({ sessionId: id, path, target: path }),
  'files.resolve': z.object({ sessionId: id, path }),
  'files.search': z.object({
    sessionId: id,
    query: z.string().max(500),
    content: z.boolean().default(false),
    requestId: id.optional(),
  }),
  'files.cancel': z.object({ sessionId: id, requestId: id }),
  'draft.put': z.object({
    sessionId: id,
    path,
    text,
    version: z.number().int().min(0),
    hash: z.string().max(128),
  }),
  'draft.drop': z.object({ sessionId: id, path, version: z.number().int().min(0) }),
} as const;

export interface FileResults {
  'files.list': FileEntry[];
  'files.read': DocumentData;
  'files.save': { hash: string };
  'files.create': null;
  'files.rename': null;
  'files.resolve': string;
  'files.search': { hits: SearchHit[]; truncated: boolean };
  'files.cancel': null;
  'draft.put': { version: number; updatedAt: number };
  'draft.drop': null;
}
