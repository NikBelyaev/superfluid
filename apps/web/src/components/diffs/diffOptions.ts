export const diffOptions = {
  theme: { light: 'github-light', dark: 'github-dark' },
  diffStyle: 'unified' as const,
  overflow: 'scroll' as const,
  unsafeCSS: `:host {
    --diffs-addition-color-override: var(--color-git-added);
    --diffs-deletion-color-override: var(--color-git-deleted);
    --diffs-modified-color-override: var(--color-git-modified);
  }`,
};

export const fileDiffOptions = { stripTrailingCr: true };
