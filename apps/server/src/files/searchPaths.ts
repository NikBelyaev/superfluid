export const searchExcludes = [
  '**/.git/**',
  '**/.worktrees/**',
  '**/.venv*/**',
  '**/venv*/**',
  '**/node_modules/**',
  '**/__pycache__/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
  '**/.pytest_cache/**',
];

export const excludedSearchPath = (path: string) =>
  path
    .split(/[\\/]/)
    .slice(0, -1)
    .some((part) =>
      /^(?:\.git|\.worktrees|\.?venv[^/]*|node_modules|__pycache__|\.(?:mypy|ruff|pytest)_cache)$/.test(
        part,
      ),
    );
