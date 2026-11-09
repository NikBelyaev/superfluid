const colors: Record<string, string> = {
  added: 'text-git-added',
  untracked: 'text-git-added',
  modified: 'text-git-modified',
  deleted: 'text-git-deleted',
  conflict: 'text-git-deleted',
  renamed: 'text-git-renamed',
  ignored: 'text-muted-foreground',
};

const emphasisClasses = {
  default: '',
  secondary: 'opacity-80',
  inactive: 'opacity-60 group-hover/file-link:opacity-100',
};

export function fileLabelClassName(
  status: string | undefined,
  emphasis: keyof typeof emphasisClasses = 'default',
) {
  return status ? [colors[status], emphasisClasses[emphasis]].filter(Boolean).join(' ') : '';
}
