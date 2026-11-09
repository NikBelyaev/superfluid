import { z } from 'zod';
import { id, path } from './schema';
import type { SearchHit } from './files';
import type { GitRepository } from './vcs';

export const searchTypes = ['class', 'file', 'document', 'symbol', 'text'] as const;
export type SearchType = (typeof searchTypes)[number];
export interface SearchMatch extends SearchHit {
  type: SearchType;
  repositoryId?: string;
}

export function searchRepository(path: string, repositories: GitRepository[]) {
  let owner: GitRepository | undefined;
  for (const repository of repositories)
    if (
      (!repository.path || path.startsWith(repository.path + '/')) &&
      (!owner || repository.path.length > owner.path.length)
    )
      owner = repository;
  return owner;
}

export const searchRequests = {
  'search.query': z.object({
    sessionId: id,
    query: z.string().max(500),
    types: z.array(z.enum(searchTypes)).max(searchTypes.length).default([]),
    repositoryIds: z.array(id).max(1000).optional(),
    requestId: id,
  }),
  'search.cancel': z.object({ sessionId: id, requestId: id }),
  'search.preview': z.object({ sessionId: id, path, line: z.number().int().min(1).optional() }),
} as const;

export interface SearchResults {
  'search.query': { hits: SearchMatch[]; truncated: boolean; warnings: string[] };
  'search.cancel': null;
  'search.preview': { text: string; startLine: number };
}
