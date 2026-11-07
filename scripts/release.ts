import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  WORKSPACE_DATA_VERSION,
  RELEASE_REPOSITORY,
  updateChannel,
} from '../packages/contracts/src/updates.ts';

const core = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const stableVersion = new RegExp(`^${core}$`);
const nightlyTag = new RegExp(`^v${core}-nightly\\.\\d{8}\\.[1-9]\\d*$`);
const stableTag = new RegExp(`^v${core}$`);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const baseOf = (version: string) => version.replace(/^v/, '').split('-')[0];
function compareCore(a: string, b: string) {
  const left = baseOf(a).split('.').map(Number),
    right = baseOf(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function planRelease(input: {
  channel: 'stable' | 'nightly';
  commit: string;
  ref: string;
  tags: string[];
  packageVersion: string;
  version?: string;
  nightly?: { tag: string; commit: string; publishedAt: string };
  run: string;
  now: Date;
  scheduled: boolean;
}) {
  const latestStable = input.tags
    .filter((tag) => stableTag.test(tag))
    .sort(compareCore)
    .at(-1);
  const tagged = input.ref.startsWith('refs/tags/');
  if (!tagged && input.ref !== 'refs/heads/main')
    throw new Error('Releases must be dispatched from main.');
  let version: string;
  let commit = input.commit;
  if (tagged) {
    if (input.channel !== 'stable') throw new Error('Tags only publish stable releases.');
    version = input.ref.slice('refs/tags/v'.length);
  } else if (input.channel === 'stable') {
    if (!input.nightly || !nightlyTag.test(input.nightly.tag))
      throw new Error('Publish and verify a nightly before promoting stable.');
    version = input.version || baseOf(input.nightly.tag);
    commit = input.nightly.commit;
  } else {
    if (input.version) throw new Error('Nightly versions are generated automatically.');
    let base = baseOf(input.packageVersion);
    if (latestStable) {
      const [major, minor, patch] = baseOf(latestStable).split('.').map(Number);
      base = `${major}.${minor}.${patch + 1}`;
    }
    if (!stableVersion.test(base) || !/^[1-9]\d*$/.test(input.run))
      throw new Error('Invalid nightly version inputs.');
    const date = input.now.toISOString().slice(0, 10).replaceAll('-', '');
    version = `${base}-nightly.${date}.${input.run}`;
  }
  if (input.channel === 'stable' && !stableVersion.test(version))
    throw new Error('Stable requires an X.Y.Z version.');
  if (
    input.channel === 'stable' &&
    latestStable &&
    compareCore(version, latestStable) <= 0 &&
    latestStable !== `v${version}`
  )
    throw new Error('Stable must be newer than the previous stable release.');
  const recent =
    input.nightly &&
    input.now.getTime() - Date.parse(input.nightly.publishedAt) < 6 * 60 * 60 * 1000;
  return {
    version,
    tag: `v${version}`,
    channel: input.channel,
    commit: sha.parse(commit),
    previousTag:
      input.channel === 'nightly'
        ? (input.nightly?.tag ?? '')
        : latestStable === `v${version}`
          ? (input.tags
              .filter((tag) => stableTag.test(tag) && tag !== latestStable)
              .sort(compareCore)
              .at(-1) ?? '')
          : (latestStable ?? ''),
    skip:
      input.scheduled &&
      Boolean(input.nightly && (recent || input.nightly.commit === input.commit)),
  };
}

export async function stampVersion(version: string, file = 'package.json') {
  if (!stableVersion.test(version) && !nightlyTag.test(`v${version}`))
    throw new Error('Invalid release version.');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  pkg.version = version;
  await writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
}

export async function mergeManifests(files: string[], output: string) {
  const { parse, stringify } = await import('yaml');
  const manifests = await Promise.all(
    files.map(async (file) =>
      z
        .object({
          version: z.string(),
          files: z
            .array(
              z.object({ url: z.string(), sha512: z.string(), size: z.number() }).passthrough(),
            )
            .nonempty(),
          path: z.string(),
          sha512: z.string(),
          releaseDate: z.string(),
        })
        .passthrough()
        .parse(parse(await readFile(file, 'utf8'))),
    ),
  );
  if (manifests.length !== 2 || manifests[0].version !== manifests[1].version)
    throw new Error('Both architecture manifests must have the same version.');
  const urls = manifests.flatMap((m) => m.files.map((f) => f.url));
  if (
    !urls.some((u) => u.includes('-arm64.')) ||
    !urls.some((u) => u.includes('-x64.')) ||
    new Set(urls).size !== urls.length
  )
    throw new Error('Update metadata must include distinct arm64 and x64 artifacts.');
  await writeFile(
    output,
    stringify({
      ...manifests[0],
      files: manifests.flatMap((m) => m.files),
      superfluidDataVersion: WORKSPACE_DATA_VERSION,
    }),
  );
}

async function main() {
  const command = process.argv[2];
  if (command === 'stamp') return stampVersion(process.argv[3]);
  if (command === 'merge') return mergeManifests(process.argv.slice(4), process.argv[3]);
  if (command !== 'plan') throw new Error('Use plan, stamp, or merge.');
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const releases = z
    .array(z.object({ tagName: z.string(), isDraft: z.boolean(), publishedAt: z.string() }))
    .parse(
      JSON.parse(
        execFileSync(
          'gh',
          [
            'release',
            'list',
            '--repo',
            RELEASE_REPOSITORY,
            '--limit',
            '100',
            '--json',
            'tagName,isDraft,publishedAt',
          ],
          { encoding: 'utf8' },
        ),
      ),
    );
  const nightly = releases.find((release) => !release.isDraft && nightlyTag.test(release.tagName));
  const plan = planRelease({
    channel: updateChannel.parse(process.env.RELEASE_CHANNEL || 'nightly'),
    version: process.env.RELEASE_VERSION,
    ref: process.env.GITHUB_REF || '',
    commit: git('rev-parse', 'HEAD'),
    packageVersion: JSON.parse(await readFile('package.json', 'utf8')).version,
    tags: git('tag', '--list').split('\n'),
    nightly: nightly
      ? {
          tag: nightly.tagName,
          publishedAt: nightly.publishedAt,
          commit: git('rev-parse', `refs/tags/${nightly.tagName}^{commit}`),
        }
      : undefined,
    scheduled: process.env.GITHUB_EVENT_NAME === 'schedule',
    now: new Date(),
    run: process.env.GITHUB_RUN_NUMBER || '',
  });
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(plan)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  console.log(JSON.stringify(plan));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
