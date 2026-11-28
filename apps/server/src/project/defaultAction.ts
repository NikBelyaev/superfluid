import { lstat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Action } from '@superfluid/contracts';
import { excludedSearchPath } from '../files/searchPaths';
import { git } from '../vcs/gitCommand';
import { goDefaultAction } from '../go/goDefaultAction';

type Suggestion = Pick<Action, 'kind' | 'name' | 'command' | 'cwd'>;
const auxiliaryExtension =
  /^\.(?:md|mdx|rst|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|lock|mod|sum|csv|pdf|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i;
const auxiliaryName =
  /^(?:readme|licen[cs]e|copying|notice|changelog|authors|contributors|contributing|security|install|version|codeowners|dockerfile(?:\.[\w-]+)?|containerfile|(?:gnu)?makefile|\.(?:gitignore|gitattributes|gitkeep|editorconfig|dockerignore|ds_store|env(?:\.[\w.-]+)?))$/i;
const detectors = [{ extensions: ['.go'], suggest: goDefaultAction }];

export async function defaultAction(root: string): Promise<Suggestion | undefined> {
  const options = { timeout: 2500, limit: 1024 * 1024 };
  const gitRoot = await lstat(join(root, '.git')).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!gitRoot) return;
  const listing = await git(
    root,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    options,
  );
  const files = [...new Set(listing.split('\0'))].filter(
    (path) => path && !excludedSearchPath(path) && !path.split('/').slice(0, -1).includes('vendor'),
  );
  if (files.includes('.gitmodules') || files.some((path) => path.endsWith('/'))) return;
  const sources = files
    .filter(
      (path) => !auxiliaryName.test(basename(path)) && !auxiliaryExtension.test(extname(path)),
    )
    .map((path) => extname(path));
  if (!sources.length) return;
  return detectors
    .find(({ extensions }) => sources.every((extension) => extensions.includes(extension)))
    ?.suggest(root, files);
}
