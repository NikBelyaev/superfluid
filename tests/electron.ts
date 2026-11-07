import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { git } from '../apps/server/src/vcs/gitCommand';

const require = createRequire(import.meta.url);

const executablePath = process.env.SF_EXECUTABLE || require('electron');

const launchArgs = process.env.SF_EXECUTABLE ? [] : [resolve('.')];

const temp = await mkdtemp(join(tmpdir(), 'superfluid-electron-'));

const project = join(temp, 'fluid-lab');

await mkdir(project);

await writeFile(
  join(project, 'models.py'),
  'class Store:\n    def count(self) -> int:\n        return 42\n',
);

await writeFile(
  join(project, 'main.py'),
  'from models import Store\n\nstore = Store()\nprint(store.count())\n',
);

await writeFile(
  join(project, 'README.md'),
  '# Fluid lab\n\nA real Python fixture for Superfluid.\n',
);

await writeFile(join(project, 'bom.py'), '\ufeffvalue = 1\r\n');

await git(project, ['init', '-b', 'main']);

await git(project, ['config', 'user.name', 'Superfluid Test']);

await git(project, ['config', 'user.email', 'test@superfluid.invalid']);

await git(project, ['add', '.']);

await git(project, ['commit', '-m', 'Initial fixture']);
await writeFile(join(project, 'README.md'), '# Fluid lab\n\nPending documentation changes.\n');

await git(project, [
  'remote',
  'add',
  'origin',
  'https://github.com/superfluid-tests/fluid-lab.git',
]);

const bin = join(temp, 'bin');

await mkdir(bin);

const prFixture = {
  number: 15,
  title: 'Keep each worktree independent',
  body: '## Summary\n\n- Preserve open files and navigation in each worktree.\n- Keep terminal processes running when switching branches.\n\n## Testing\n\nPython navigation, document recovery and terminal reconnect pass locally.',
  state: 'OPEN',
  url: 'https://github.com/superfluid-tests/fluid-lab/pull/15',
  author: { login: 'fluid-dev' },
  baseRefName: 'main',
  headRefName: 'feature/parallel',
  headRefOid: 'a'.repeat(40),
  additions: 24,
  deletions: 8,
  changedFiles: 2,
  comments: [
    { author: { login: 'reviewer' }, body: 'The worktree state is easier to follow now.' },
  ],
  commits: [
    {
      oid: 'b'.repeat(40),
      messageHeadline: 'Preserve worktree document state',
      committedDate: '2026-11-05T12:00:00Z',
    },
  ],
  reviews: [
    {
      author: { login: 'reviewer' },
      state: 'APPROVED',
      body: 'Navigation and recovery look good.',
    },
  ],
  statusCheckRollup: [
    { name: 'Python tests', conclusion: 'SUCCESS' },
    { name: 'Electron smoke', conclusion: 'SUCCESS' },
  ],
};

const prPatch =
  'diff --git a/models.py b/models.py\nindex 1234567..abcdef0 100644\n--- a/models.py\n+++ b/models.py\n@@ -1,3 +1,3 @@\n-class Store:\n+class Inventory:\n     def count(self) -> int:\n         return 42\n';

await writeFile(
  join(bin, 'gh'),
  '#!/usr/bin/env node\n' +
    `const args=process.argv.slice(2); if(args[0]!=='pr') process.exit(2);\n` +
    `if(args[1]==='view') process.stdout.write(${JSON.stringify(JSON.stringify(prFixture))});\n` +
    `else if(args[1]==='diff') process.stdout.write(${JSON.stringify(prPatch)}); else process.exit(2);\n`,
  { mode: 0o755 },
);

await mkdir('test-results', { recursive: true });

const launchEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

launchEnv.SF_DATA_DIR = join(temp, 'data');

launchEnv.SF_TEST = '1';

launchEnv.PATH = bin + ':' + launchEnv.PATH;

if (process.env.SF_EXECUTABLE) launchEnv.SF_DEV_URL = 'https://untrusted.invalid';

delete launchEnv.ELECTRON_RUN_AS_NODE;

let app = await electron.launch({
  executablePath,
  args: [...launchArgs, '--project=' + project],
  env: launchEnv,
  timeout: 30000,
});

let nativeOutput = '';

let appProcess = app.process();

const captureNativeOutput = () => {
  appProcess = app.process();
  appProcess.stderr?.on('data', (chunk) => {
    nativeOutput = (nativeOutput + chunk.toString()).slice(-16384);
  });
};

captureNativeOutput();

async function closeApp() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'Electron did not finish safe shutdown within 30 seconds.\n' + nativeOutput,
              ),
            ),
          30000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const errors: string[] = [];

let preview: Server | undefined;

let failed = false;

try {
  const page = await app.firstWindow();
  if (process.env.SF_EXECUTABLE) assert.ok(page.url().startsWith('superfluid://app/'));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      node: typeof (window as any).process,
      require: typeof (window as any).require,
    })),
    { node: 'undefined', require: 'undefined' },
  );
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .waitFor();
  await page.screenshot({ path: 'test-results/welcome.png' });
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click({ timeout: 30000 });
  await page.locator('.tree-row').filter({ hasText: 'bom.py' }).waitFor();
  await page.screenshot({ path: 'test-results/editor-empty.png' });
  const gitMenu = page.getByRole('button', { name: 'Individual Git actions', exact: true });
  await page.locator('.repository-operation:not(:disabled)').waitFor();
  await gitMenu.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('menu').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('End');
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Apply stash', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.screenshot({ path: 'test-results/git-menu.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Individual Git actions',
  );
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.tree-row').filter({ hasText: 'bom.py' }).click();
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText('# saved through Monaco\r\n');
  await page.keyboard.press('Meta+S');
  await page.waitForTimeout(150);
  const bom = await readFile(join(project, 'bom.py'), 'utf8');
  assert.ok(bom.startsWith('\ufeff'));
  assert.ok(bom.includes('\r\n'));
  await page.locator('.tree-row').filter({ hasText: 'main.py' }).click();
  await page.getByRole('tab', { name: 'main.py', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page
      .getByRole('tab', { name: 'bom.py', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press('Enter');
  await page.locator('.editor-tab.active').filter({ hasText: 'bom.py' }).waitFor();
  await page.getByRole('tab', { name: 'main.py', exact: true }).click();
  await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' });
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    'from models import Store\n\n# main unsaved\nprint(Store().count())\n',
  );
  await page.getByRole('button', { name: 'New worktree', exact: true }).first().click();
  await page.getByLabel('Branch name').fill('feature/parallel');
  await page.getByLabel('Start from').fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.worktree-chip.active').filter({ hasText: 'feature/parallel' }).waitFor();
  await page.locator('.tree-row').filter({ hasText: 'main.py' }).click();
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    'from models import Store\n\n# feature unsaved\nprint(Store().count())\n',
  );
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('.view-lines')
      ?.textContent?.replaceAll('\u00a0', ' ')
      .includes('main unsaved'),
  );
  assert.equal(
    await page
      .locator('.main-editor')
      .innerText()
      .then((t) => t.includes('feature unsaved')),
    false,
  );
  await page.keyboard.press('Meta+S');
  await page.waitForTimeout(300);
  assert.match(await readFile(join(project, 'main.py'), 'utf8'), /main unsaved/);
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+ArrowUp');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F12');
  await page.locator('.editor-tab.active').filter({ hasText: 'models.py' }).waitFor();
  await page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await page.locator('.editor-tab.active').filter({ hasText: 'main.py' }).waitFor();
  await page.keyboard.press('F2');
  await page.getByLabel('New symbol name').fill('Inventory');
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to buffers', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.view-lines')?.textContent?.includes('Inventory'),
  );
  await page.keyboard.press('Meta+S');
  await page.getByRole('tab', { name: /models.py/ }).click();
  await page.locator('.breadcrumb').getByText('models.py', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.view-lines')?.textContent?.includes('Inventory'),
  );
  await page.keyboard.press('Meta+S');
  for (let i = 0; i < 100; i++) {
    if ((await readFile(join(project, 'models.py'), 'utf8')).includes('class Inventory')) break;
    await page.waitForTimeout(25);
  }
  assert.match(await readFile(join(project, 'models.py'), 'utf8'), /class Inventory/);
  await page.getByRole('tab', { name: /main.py/ }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.getByRole('textbox', { name: 'Terminal input' }).focus();
  await page.keyboard.insertText(
    "printf '\\123\\125\\120\\105\\122\\106\\114\\125\\111\\104\\137\\101\\114\\111\\126\\105\\n'",
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Terminal output"]')
        ?.textContent?.includes('SUPERFLUID_ALIVE'),
    {},
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: 'Add project action', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('Python smoke');
  await page.getByLabel('Action type').selectOption('python');
  await page.getByLabel('Python file', { exact: true }).fill('main.py');
  await page.screenshot({ path: 'test-results/action-dialog.png' });
  await page.getByRole('button', { name: 'Create action', exact: true }).click();
  await page.getByRole('button', { name: 'Python smoke', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Terminal output"]')?.textContent?.includes('42'),
  );
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Terminal output"]')
      ?.textContent?.includes('SUPERFLUID_ALIVE'),
  );
  await page.screenshot({ path: 'test-results/workspace.png' });
  await page
    .getByRole('button', { name: /^Changes/ })
    .last()
    .click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/changes.png' });
  const measures: number[] = [];
  for (let i = 0; i < 30; i++) {
    const target = i % 2 === 0 ? 'feature/parallel' : 'main';
    await page
      .locator('.worktree-chip')
      .filter({ hasText: target === 'main' ? /^main$/ : /^feature\/parallel$/ })
      .click();
    await page.waitForFunction(
      (target) =>
        document
          .querySelector('.view-lines')
          ?.textContent?.replaceAll('\u00a0', ' ')
          .includes(target === 'main' ? 'main unsaved' : 'feature unsaved'),
      target,
    );
    const time = await page.evaluate(() => {
      const starts = performance.getEntriesByName('superfluid:switch-start'),
        ends = performance.getEntriesByName('superfluid:editor-bound');
      return ends.at(-1)!.startTime - starts.at(-1)!.startTime;
    });
    measures.push(time);
  }
  const sorted = [...measures].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        sampleCount: sorted.length,
        switchP50: sorted[Math.floor(sorted.length * 0.5)],
        switchP95: sorted[Math.floor(sorted.length * 0.95)],
        errors,
      },
      null,
      2,
    ),
  );
  await writeFile(
    'test-results/smoke-metrics.json',
    JSON.stringify(
      { sampleCount: sorted.length, switchP50: sorted[15], switchP95: sorted[28], errors },
      null,
      2,
    ),
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.keyboard.press('Meta+P');
  await page.locator('.palette').waitFor();
  await page.screenshot({ path: 'test-results/file-palette.png' });
  await page.keyboard.press('Escape');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Open a surface', exact: true })
    .click();
  await page.getByRole('button', { name: 'Pull request', exact: true }).click();
  await page.getByRole('heading', { name: prFixture.title }).waitFor();
  await page.screenshot({ path: 'test-results/pr-summary.png' });
  const prTabs = page.getByRole('tablist', { name: 'Pull request', exact: true });
  await prTabs.getByRole('tab', { name: 'Summary', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await prTabs.getByRole('tab', { name: 'Timeline', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.screenshot({ path: 'test-results/pr-timeline.png' });
  await page.keyboard.press('ArrowRight');
  await page.locator('.pr-panel diffs-container').waitFor();
  await page.screenshot({ path: 'test-results/pr-code.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.waitForFunction(() => {
    if (innerWidth !== 1280) return false;
    const list = document.querySelector('.surface-tabs')!.getBoundingClientRect();
    const tab = document
      .querySelector('.surface-tabs [aria-selected="true"]')!
      .getBoundingClientRect();
    return tab.left >= list.left && tab.right <= list.right;
  });
  await page.getByRole('button', { name: 'Collapse actions', exact: true }).waitFor();
  const geometry = await page.evaluate(() => {
    const island = document.querySelector('.island')!.getBoundingClientRect();
    const editor = document.querySelector('.main-editor')!.getBoundingClientRect();
    const collapse = document.querySelector('[title="Collapse actions"]')!.getBoundingClientRect();
    return {
      islandLeft: island.left,
      editorLeft: editor.left,
      islandRight: island.right,
      editorRight: editor.right,
      collapseBottom: collapse.bottom,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };
  });
  assert.ok(
    geometry.islandLeft >= geometry.editorLeft && geometry.islandRight <= geometry.editorRight,
  );
  assert.ok(geometry.collapseBottom < geometry.viewportHeight);
  const hideSurface = await page
    .getByRole('button', { name: 'Hide secondary surface', exact: true })
    .boundingBox();
  assert.ok(hideSurface && hideSurface.x + hideSurface.width <= geometry.viewportWidth);
  await page.screenshot({ path: 'test-results/workspace-1280.png' });
  await page.getByRole('button', { name: 'Collapse actions', exact: true }).click();
  await page.getByRole('button', { name: 'Expand actions', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1512, 980));
  preview = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Superfluid preview fixture</title><main>Isolated preview</main>',
    );
  });
  await new Promise<void>((resolve) => preview!.listen(0, '127.0.0.1', resolve));
  const address = preview.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/preview`;
  await page.evaluate(
    (url) =>
      window.superfluid.browser({
        url,
        visible: true,
        bounds: { x: 1000, y: 180, width: 450, height: 650 },
      }),
    url,
  );
  assert.deepEqual(
    await app.evaluate(async ({ webContents }, url) => {
      const view = webContents.getAllWebContents().find((view) => view.getURL() === url);
      if (!view) throw new Error('Native preview was not created.');
      return view.executeJavaScript('({node:typeof process,bridge:typeof window.superfluid})');
    }, url),
    { node: 'undefined', bridge: 'undefined' },
  );
  await assert.rejects(
    () =>
      page.evaluate(() => window.superfluid.browser({ visible: true, url: 'file:///etc/passwd' })),
    /HTTP or HTTPS/,
  );
  await page.evaluate(() => window.superfluid.browser({ visible: false }));
  preview.closeAllConnections();
  await new Promise<void>((resolve) => preview!.close(() => resolve()));
  preview = undefined;
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/parallel$/ })
    .click();
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('# newest edit must survive immediate quit\n');
  await closeApp();
  app = await electron.launch({
    executablePath,
    args: launchArgs,
    env: launchEnv,
    timeout: 30000,
  });
  captureNativeOutput();
  const restored = await app.firstWindow();
  await restored
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await restored
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/parallel$/ })
    .click();
  await restored.waitForFunction(() =>
    document
      .querySelector('.view-lines')
      ?.textContent?.replaceAll('\u00a0', ' ')
      .includes('newest edit must survive immediate quit'),
  );
  await restored.getByText('Recovered unsaved changes.', { exact: false }).waitFor();
  await restored.keyboard.insertText('# cursor restored');
  await restored.waitForFunction(() =>
    document
      .querySelector('.view-lines .view-line:last-child')
      ?.textContent?.replaceAll('\u00a0', ' ')
      .includes('# cursor restored'),
  );
  console.log('Electron smoke passed:', project);
} catch (e) {
  failed = true;
  const page = await app.firstWindow();
  await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
  console.error('Electron fixture:', temp);
  console.error('Renderer errors:', errors);
  console.error('Native output:', nativeOutput);
  throw e;
} finally {
  preview?.closeAllConnections();
  preview?.close();
  try {
    if (!failed) await closeApp();
  } finally {
    if (appProcess.exitCode === null) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
  }
}
