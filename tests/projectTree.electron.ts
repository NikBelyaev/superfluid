import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { git } from '../apps/server/src/vcs/gitCommand';

const require = createRequire(import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'superfluid-project-tree-'));
const project = join(temp, 'tree-fixture');
await mkdir(join(project, 'src/core/deep'), { recursive: true });
await mkdir(join(project, 'src/before'));
await Promise.all([
  ...Array.from({ length: 10 }, (_, i) =>
    writeFile(join(project, `src/before/file_${i}.py`), 'pass\n'),
  ),
  ...Array.from({ length: 60 }, (_, i) =>
    writeFile(join(project, `src/core/deep/file_${i}.py`), 'pass\n'),
  ),
  ...Array.from({ length: 100 }, (_, i) => writeFile(join(project, `z_${i}.py`), 'pass\n')),
]);
await git(project, ['init', '-b', 'main']);
await git(project, ['add', '.']);
await git(project, [
  '-c',
  'user.name=Fixture',
  '-c',
  'user.email=fixture@superfluid.invalid',
  'commit',
  '-m',
  'Tree fixture',
]);

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.SF_DATA_DIR = join(temp, 'data');
env.SF_TEST = '1';
delete env.ELECTRON_RUN_AS_NODE;
delete env.SF_DEV_URL;
const app = await electron.launch({
  executablePath: process.env.SF_EXECUTABLE || require('electron'),
  args: [...(process.env.SF_EXECUTABLE ? [] : [resolve('.')]), '--project=' + project],
  env,
  recordVideo: { dir: temp },
});

try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: /tree-fixture/ })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  const row = (path: string) => page.locator(`[data-path="${path}"]`);
  const tree = page.getByRole('tree', { name: 'Project files' });
  const scroll = async () => {
    await tree.evaluate((element) => {
      element.scrollTop = 567;
    });
    await page.waitForFunction(() => document.querySelector('.tree-scroll')?.scrollTop === 567);
    await row('src/core').locator('.file-label').waitFor();
  };
  const offset = (path: string) =>
    row(path).evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.closest('.tree-scroll')!.getBoundingClientRect().top,
    );

  for (const path of ['src', 'src/before', 'src/core', 'src/core/deep']) await row(path).click();
  await row('src/core/deep/file_0.py').click();
  await page.getByRole('tab', { name: 'file_0.py', exact: true }).waitFor();
  await scroll();
  await row('src/core').locator('.file-label').click();
  assert.equal(await row('src/core').count(), 1, 'the revealed folder stays visible');
  assert.equal(
    await row('src/core').getAttribute('aria-expanded'),
    'true',
    'a sticky label reveals without collapsing',
  );
  assert.equal(await tree.evaluate((element) => element.scrollTop), 308);

  await scroll();
  const before = await offset('src/core/deep');
  await row('src/core/deep').getByRole('button', { name: 'Collapse deep', exact: true }).click();
  assert.equal(await row('src/core/deep').getAttribute('aria-expanded'), 'false');
  assert.equal(
    await offset('src/core/deep'),
    before,
    'collapse keeps the folder at the same screen position',
  );
  assert.equal(await row('src/core').getAttribute('aria-expanded'), 'true');
  await page.getByRole('tab', { name: 'file_0.py', exact: true }).waitFor();
  await row('src/core/deep').getByRole('button', { name: 'Expand deep', exact: true }).click();
  await row('src/core/deep/file_0.py').waitFor();

  await scroll();
  await row('src/core').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await row('src/core').getAttribute('aria-expanded'), 'false');
  assert.equal(await offset('src/core'), 28);
  assert.equal(
    await row('src/core').evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowRight');
  await row('src/core/deep/file_0.py').waitFor();
  assert.equal(
    await row('src/core/deep').getAttribute('aria-expanded'),
    'true',
    'nested expansion survives parent collapse',
  );
  await row('src/core/deep').focus();
  await page.keyboard.press('Enter');
  assert.equal(await row('src/core/deep').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(errors, []);
  console.log('Project tree gestures passed. Evidence:', temp);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: join(temp, 'failure.png') });
  console.error('Project tree fixture:', temp);
  throw error;
} finally {
  await app.close();
}
