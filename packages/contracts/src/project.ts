import { z } from 'zod';
import { id, path } from './schema';

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}

export interface Session {
  repositoryWorktree?: boolean;
  id: string;
  projectId: string;
  path: string;
  branch: string;
  head: string;
  gitDir: string;
  python: string;
  state: Record<string, unknown>;
  available: boolean;
}

export const projectRequests = {
  'project.add': z.object({ path }),
  'project.clone': z.object({ url: z.string().min(1).max(2048), destination: path }),
  'session.list': z.object({ projectId: id }),
  'session.create': z.object({
    sessionId: id,
    branch: z.string().min(1).max(160),
    base: z.string().min(1).max(200),
  }),
  'session.state': z.object({ sessionId: id, state: z.record(z.string(), z.unknown()) }),
  'session.interpreter': z.object({ sessionId: id, python: path }),
} as const;

export interface ProjectResults {
  'project.add': Project;
  'project.clone': Project;
  'session.list': Session[];
  'session.create': Session;
  'session.state': null;
  'session.interpreter': Session;
}
