import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { temp } from './fixtures';
import { planRelease, mergeManifests, stampVersion } from '../scripts/release';
import { WORKSPACE_DATA_VERSION } from '@superfluid/contracts';

const input = {
  channel: 'nightly' as const,
  commit: 'a'.repeat(40),
  ref: 'refs/heads/main',
  tags: ['v0.1.9', 'v0.1.10', 'v0.1.11-nightly.20261106.8'],
  packageVersion: '0.1.0-alpha.1',
  run: '42',
  now: new Date('2026-11-07T12:00:00Z'),
  scheduled: false,
  nightly: {
    tag: 'v0.1.11-nightly.20261106.8',
    commit: 'b'.repeat(40),
    publishedAt: '2026-11-06T12:00:00Z',
  },
};

test('nightlies use the next stable patch, UTC date and run; schedules skip unchanged or recent builds', () => {
  const plan = planRelease(input);
  assert.equal(plan.version, '0.1.11-nightly.20261107.42');
  assert.equal(plan.previousTag, input.nightly.tag);
  assert.equal(plan.commit, input.commit);
  assert.equal(plan.skip, false);
  assert.equal(planRelease({ ...input, scheduled: true, commit: input.nightly.commit }).skip, true);
  const recent = { ...input.nightly, publishedAt: '2026-11-07T08:00:00Z' };
  assert.equal(planRelease({ ...input, scheduled: true, nightly: recent }).skip, true);
  assert.equal(planRelease({ ...input, nightly: recent }).skip, false);
  assert.equal(
    planRelease({ ...input, tags: [], nightly: undefined }).version,
    '0.1.0-nightly.20261107.42',
  );
});

test('stable promotes the tested nightly commit and permits explicit tagged fixes and version overrides', () => {
  const stable = planRelease({ ...input, channel: 'stable' });
  assert.equal(stable.version, '0.1.11');
  assert.equal(stable.commit, input.nightly.commit);
  assert.equal(stable.previousTag, 'v0.1.10');
  assert.equal(planRelease({ ...input, channel: 'stable', version: '0.2.0' }).version, '0.2.0');
  const tagged = planRelease({
    ...input,
    channel: 'stable',
    ref: 'refs/tags/v0.1.12',
    tags: [...input.tags, 'v0.1.12'],
  });
  assert.equal(tagged.commit, input.commit);
  assert.equal(tagged.version, '0.1.12');
  assert.equal(tagged.previousTag, 'v0.1.10');
  for (const version of ['0.0.1', '0.1.12-beta.1', '01.2.3', '1.2.3\ninjected=true'])
    assert.throws(() => planRelease({ ...input, channel: 'stable', version }));
  assert.throws(() => planRelease({ ...input, ref: 'refs/heads/feature/releases' }), /main/);
  assert.throws(
    () => planRelease({ ...input, channel: 'stable', nightly: undefined }),
    /verify a nightly/,
  );
});

test('the packaged version and merged update metadata agree for both architectures', async () => {
  const directory = await temp();
  const pkg = join(directory, 'package.json');
  await writeFile(pkg, JSON.stringify({ version: '0.1.0-alpha.1', name: 'superfluid' }));
  const version = '0.1.1-nightly.20261107.42';
  await stampVersion(version, pkg);
  assert.deepEqual(JSON.parse(await readFile(pkg, 'utf8')), { version, name: 'superfluid' });
  await assert.rejects(stampVersion('v1.0.0', pkg));
  const files: string[] = [];
  for (const arch of ['arm64', 'x64']) {
    const url = `Superfluid-${version}-${arch}.zip`;
    const file = join(directory, `${arch}.yml`);
    await writeFile(
      file,
      stringify({
        version,
        files: [{ url, sha512: 'hash', size: 12 }],
        path: url,
        sha512: 'hash',
        releaseDate: '2026-11-07T12:00:00Z',
      }),
    );
    files.push(file);
  }
  const merged = join(directory, 'nightly-mac.yml');
  await mergeManifests(files, merged);
  const result = parse(await readFile(merged, 'utf8'));
  assert.equal(result.version, version);
  assert.equal(result.superfluidDataVersion, WORKSPACE_DATA_VERSION);
  assert.deepEqual(
    result.files.map((f: { url: string }) => f.url),
    [`Superfluid-${version}-arm64.zip`, `Superfluid-${version}-x64.zip`],
  );
  await assert.rejects(mergeManifests([files[0], files[0]], merged), /distinct/);
  const wrong = parse(await readFile(files[1], 'utf8'));
  wrong.version = '0.1.0';
  await writeFile(files[1], stringify(wrong));
  await assert.rejects(mergeManifests(files, merged), /same version/);
});
