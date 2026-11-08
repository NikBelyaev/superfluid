import { z } from 'zod';
import type { HostingTarget, RunHosting } from '../HostingProvider';

const changes = z.array(
  z.object({
    old_path: z.string(),
    new_path: z.string(),
    diff: z.string(),
    new_file: z.boolean(),
    deleted_file: z.boolean(),
    collapsed: z.boolean().optional(),
    too_large: z.boolean().optional(),
  }),
);

export async function gitLabCommitPatch(run: RunHosting, target: HostingTarget, commit: string) {
  const parts: string[] = [];
  for (let page = 1; ; page++) {
    const raw = await run(
      'glab',
      [
        'api',
        `projects/${encodeURIComponent(target.targetProject)}/repository/commits/${commit}/diff?per_page=100&page=${page}`,
        '--hostname',
        target.host,
      ],
      target,
    );
    const files = changes.parse(JSON.parse(raw));
    for (const file of files) {
      if (file.collapsed || file.too_large)
        throw new Error(
          'GitLab truncated this commit diff. Open the commit on GitLab to inspect all changes.',
        );
      const before = JSON.stringify('a/' + file.old_path),
        after = JSON.stringify('b/' + file.new_path);
      parts.push(
        `diff --git ${before} ${after}\n--- ${file.new_file ? '/dev/null' : before}\n+++ ${file.deleted_file ? '/dev/null' : after}\n${file.diff}${file.diff.endsWith('\n') ? '' : '\n'}`,
      );
    }
    if (files.length < 100) return parts.join('');
  }
}
