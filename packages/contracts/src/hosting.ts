import { z } from 'zod';
import type { Project } from './project';

export function repositoryConnection(project: Project | undefined, path: string) {
  return {
    binding: path ? undefined : project?.hosting,
    remote: path ? project?.gitRemotes?.[path] : project?.gitRemote,
  };
}

export const projectPath = z
  .string()
  .min(3)
  .max(1024)
  .refine(
    (value) =>
      value.split('/').length >= 2 &&
      value.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'),
    'Use a namespace/project path.',
  );
export const gitRemoteName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w][\w./-]*$/);
export const hostingBindingSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  host: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => {
      try {
        const url = new URL(`https://${value}`);
        return url.host === value && !url.username && !url.password;
      } catch {
        return false;
      }
    }, 'Use a hostname with an optional port.'),
  remote: gitRemoteName,
  sourceProject: projectPath,
  targetProject: projectPath,
});
export type HostingBinding = z.infer<typeof hostingBindingSchema>;
export interface HostingContext extends HostingBinding {
  upstreamProject?: string | null;
  branch: string;
  defaultBranch: string;
  revision: string;
}
export interface RepositoryRemotes {
  names: string[];
  selected: string | null;
}
export interface SourceControlRepository {
  host: string;
  project: string;
  provider: 'github' | 'gitlab' | null;
}

export interface SourceControlAccount {
  host: string;
  login: string | null;
  authenticated: boolean;
  active: boolean;
}

export interface SourceControlTool {
  kind: 'git' | 'github' | 'gitlab';
  label: string;
  executable: string;
  status: 'available' | 'missing' | 'error';
  version: string | null;
  auth: 'authenticated' | 'unauthenticated' | 'unknown' | null;
  accounts: SourceControlAccount[];
  detail: string;
}

export interface SourceControlDiscovery {
  versionControlSystems: SourceControlTool[];
  sourceControlProviders: SourceControlTool[];
}
