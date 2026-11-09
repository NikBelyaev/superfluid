import { useMemo } from 'react';
import { treeGit } from '~/components/sidebar/treeGit';
import { fileRepository } from '~/state/repositories';
import { useApp } from '~/state/workspaceStore';

export function useFileGitStatus(sessionId: string) {
  const repositories = useApp((a) => a.repositories[sessionId]);
  const statuses = useApp((a) => a.repositoryGit[sessionId]);
  const git = useMemo(
    () =>
      new Map(Object.entries(statuses || {}).map(([id, status]) => [id, treeGit(status.files)])),
    [statuses],
  );
  return (path: string) => {
    const repository = fileRepository(repositories || [], path);
    if (repository)
      return git
        .get(repository.id)
        ?.getStatus(repository.path ? path.slice(repository.path.length + 1) : path);
  };
}
