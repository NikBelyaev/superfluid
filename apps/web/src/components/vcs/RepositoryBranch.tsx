import { useApp } from '~/state/workspaceStore';
import { selectedRepositories } from '~/state/repositories';

export function RepositoryBranch({ sessionId }: { sessionId: string }) {
  const repositories = useApp((s) => s.repositories[sessionId]);
  const ids = useApp((s) => s.views[sessionId]?.repositoryIds);
  const selected = selectedRepositories(repositories || [], ids);
  const branches = [...new Set(selected.map((r) => r.branch))];
  return (
    <span className="repository-branch-summary">
      <span>{branches[0] || 'Repositories'}</span>
      {branches.length > 1 && (
        <span className="repository-extra-branches">+ {branches.length - 1}</span>
      )}
      {repositories && repositories.length > 1 && (
        <span
          className="repository-extra-branches repository-selection-count"
          title="Selected repositories"
        >
          {selected.length}/{repositories.length}
        </span>
      )}
    </span>
  );
}
