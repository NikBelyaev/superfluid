import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { githubRequest, gitlabRequest } from './hostingFixtures';
import { git } from '../apps/server/src/vcs/gitCommand';
import { repository } from './fixtures';

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

const prFixture = { ...githubRequest, body: '## Summary\n\nKeep each worktree independent.' };

const prPatch =
  'diff --git a/models.py b/models.py\nindex 1234567..abcdef0 100644\n--- a/models.py\n+++ b/models.py\n@@ -1,3 +1,3 @@\n-class Store:\n+class Inventory:\n     def count(self) -> int:\n         return 42\n';

const ghState = join(temp, 'github.json');
const glState = join(temp, 'gitlab.json');
await writeFile(ghState, JSON.stringify(prFixture));
await writeFile(glState, JSON.stringify(gitlabRequest));
for (const cli of ['gh', 'glab'])
  await writeFile(
    join(bin, cli),
    '#!' +
      process.execPath +
      '\n' +
      `
const fs = require('node:fs');
const args = process.argv.slice(2);
const file = ${JSON.stringify(cli === 'gh' ? ghState : glState)};
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
const gitlab = ${cli === 'glab'};
if(args[0] === '--version') console.log(gitlab ? 'glab 1.128.0' : 'gh version 2.80.0');
else if(args[0] === 'auth') console.log(JSON.stringify(value.signedOut ? (gitlab ? {hosts:[]} : {hosts:{}}) : gitlab ? {hosts:[{host:'gitlab.example.test',user:'fluid-dev',state:'success'}]} : {hosts:{'github.com':[{login:'fluid-dev',active:true,state:'success'}]}}));
else if(args[0] === 'repo') { if(value.denyRepository) { console.error('Project access denied by fixture'); process.exit(1); } console.log(JSON.stringify(gitlab ? {id: 11, default_branch: args[2].includes('/people/') ? 'main' : 'develop',forked_from_project:args[2].includes('/people/') ? {path_with_namespace:'platform/editor'} : null} : {defaultBranchRef: {name: 'main'},parent:null})); }
else if(args[1] === 'list') console.log(JSON.stringify([value]));
else if(args[1] === 'view') { if(value.failRead) { console.error('Refresh rejected by fixture'); process.exit(1); } console.log(JSON.stringify(value)); }
else if(args[0] === 'api') { let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => { value.description=JSON.parse(body).description;fs.writeFileSync(file,JSON.stringify(value)); }); }
else if(args[1] === 'diff') process.stdout.write(${JSON.stringify(prPatch)});
else if(args[1] === 'update' || args[1] === 'edit') {
 let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
  const title = args.indexOf('--title'); if(title >= 0) value.title = args[title+1];
  if(args.includes('--description-file') || args.includes('--body-file')) value[gitlab ? 'description' : 'body'] = body;
  value[gitlab ? 'updated_at' : 'updatedAt'] = '2026-11-07T13:00:00Z'; fs.writeFileSync(file,JSON.stringify(value));
 });
} else if(args[1] === 'note' || args[1] === 'comment') {
 let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
  value.commentAttempts = (value.commentAttempts || 0) + 1;
  if (value.failComment) { fs.writeFileSync(file,JSON.stringify(value)); console.error('Comment rejected by fixture'); process.exit(1); }
  if (gitlab) value.Discussions.push({id:'posted-'+value.commentAttempts,notes:[{id:200+value.commentAttempts,author:{username:'fluid-dev'},body,created_at:'2026-11-07T14:00:00Z',system:false}]});
  else value.comments.push({id:'posted-'+value.commentAttempts,author:{login:'fluid-dev'},body,createdAt:'2026-11-07T14:00:00Z'});
  fs.writeFileSync(file,JSON.stringify(value));
 });
}
else process.exit(2);
`,
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
  await expect(page.locator('.main-editor .view-lines')).toContainText('value = 1');
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
  await expect(page.locator('.main-editor .view-lines')).toContainText('store = Store()');
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
  await expect(page.locator('.main-editor .view-lines')).toContainText('store = Store()');
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    'from models import Store\n\n# feature unsaved\nprint(Store().count())\n',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('feature unsaved');
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
    await expect(page.locator('.main-editor .view-lines')).toContainText(
      target === 'main' ? 'main unsaved' : 'feature unsaved',
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
  await page.getByRole('button', { name: 'Pull / merge requests', exact: true }).click();
  await page.getByRole('button', { name: /Keep each worktree independent/ }).click();
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
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Settings: Source Control', exact: true }).click();
  await page.getByRole('heading', { name: 'Version Control', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Source control providers', exact: true }).waitFor();
  await page.getByRole('switch', { name: 'GitLab availability', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle GitLab details', exact: true }).click();
  await page
    .locator('.source-control-account strong')
    .filter({ hasText: /^gitlab\.example\.test$/ })
    .waitFor();
  await page.screenshot({ path: 'test-results/source-control-settings.png' });
  await page.getByRole('button', { name: 'Reveal GitLab accounts', exact: true }).click();
  await page.locator('.source-control-login').filter({ hasText: 'fluid-dev' }).waitFor();
  const githubSettings = page
    .locator('.source-control-tool')
    .filter({ has: page.getByRole('switch', { name: 'GitHub availability', exact: true }) });
  const gitlabSettings = page
    .locator('.source-control-tool')
    .filter({ has: page.getByRole('switch', { name: 'GitLab availability', exact: true }) });
  await page.getByRole('button', { name: 'Toggle GitHub details', exact: true }).click();
  await githubSettings.getByText('Connection instructions', { exact: true }).click();
  await githubSettings.getByText('Install command', { exact: true }).click();
  await gitlabSettings.getByText('Connection instructions', { exact: true }).click();
  await gitlabSettings.getByText('Install command', { exact: true }).click();
  for (const [settings, cli] of [
    [githubSettings, 'gh'],
    [gitlabSettings, 'glab'],
  ] as const) {
    for (const manager of ['brew', 'winget', 'scoop', 'choco']) {
      await settings.getByRole('button', { name: manager, exact: true }).click();
      const expected =
        manager === 'winget'
          ? cli === 'gh'
            ? 'winget install --id GitHub.cli --source winget'
            : 'winget install glab.glab'
          : `${manager} install ${cli}`;
      assert.equal(
        await settings.locator('.source-control-snippet pre').first().innerText(),
        '$' + expected,
      );
    }
  }
  await githubSettings.getByRole('button', { name: 'repo', exact: true }).hover();
  await page.getByRole('tooltip').filter({ hasText: 'Read and write repositories' }).waitFor();
  await githubSettings.getByRole('button', { name: 'Classic PAT', exact: true }).click();
  assert.ok(
    !(await githubSettings.locator('.source-control-snippet pre').last().innerText()).includes(
      '--web',
    ),
  );
  await githubSettings.getByRole('button', { name: 'Browser', exact: true }).click();
  assert.ok(
    (await githubSettings.locator('.source-control-snippet pre').last().innerText()).includes(
      '--web',
    ),
  );
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async text => { document.documentElement.dataset.copiedCommand = text; } }
  })`);
  const copyInstall = githubSettings.getByRole('button', {
    name: 'Copy gh install command',
    exact: true,
  });
  await copyInstall.click();
  await githubSettings.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-copied-command'), 'choco install gh');
  await page.evaluate(
    `navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied by fixture'); }`,
  );
  await githubSettings.getByRole('button', { name: 'Copy gh login command', exact: true }).click();
  await githubSettings.getByRole('button', { name: 'Could not copy', exact: true }).waitFor();
  await page.evaluate(
    'delete navigator.clipboard; delete document.documentElement.dataset.copiedCommand',
  );
  await gitlabSettings.getByRole('row', { name: 'Pipeline Read', exact: true }).waitFor();
  await gitlabSettings.getByRole('row', { name: 'Job Read', exact: true }).waitFor();
  await gitlabSettings.getByRole('checkbox', { name: 'Git over HTTPS', exact: true }).check();
  await gitlabSettings.getByRole('row', { name: 'Code Download · Push', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/source-control-onboarding.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await git(project, [
    'remote',
    'set-url',
    'origin',
    'git@gitlab.example.test:people/fluid/editor.git',
  ]);
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Settings: Source Control', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle GitLab details', exact: true }).click();
  await gitlabSettings.getByText('Connection instructions', { exact: true }).click();
  assert.ok(
    (await gitlabSettings.locator('.source-control-snippet pre').last().innerText()).includes(
      '--hostname gitlab.example.test',
    ),
  );
  await gitlabSettings.getByRole('button', { name: 'Check connection', exact: true }).click();
  await gitlabSettings
    .getByRole('status')
    .filter({ hasText: 'Project people/fluid/editor is accessible.' })
    .waitFor();
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), denyRepository: true }),
  );
  await gitlabSettings.getByRole('button', { name: 'Check connection', exact: true }).click();
  await gitlabSettings
    .getByRole('alert')
    .filter({ hasText: 'Project access denied by fixture' })
    .waitFor();
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      denyRepository: false,
      signedOut: true,
    }),
  );
  await gitlabSettings.getByRole('button', { name: 'Check connection', exact: true }).click();
  await gitlabSettings
    .getByRole('alert')
    .filter({ hasText: 'glab auth login --hostname gitlab.example.test' })
    .waitFor();
  assert.equal(
    await gitlabSettings
      .getByRole('switch', { name: 'GitLab availability', exact: true })
      .isChecked(),
    false,
  );
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), signedOut: false }),
  );
  await gitlabSettings.getByRole('button', { name: 'Check connection', exact: true }).click();
  await gitlabSettings
    .getByRole('status')
    .filter({ hasText: 'Project people/fluid/editor is accessible.' })
    .waitFor();
  assert.equal(
    await gitlabSettings
      .getByRole('switch', { name: 'GitLab availability', exact: true })
      .isChecked(),
    true,
  );
  await page.screenshot({ path: 'test-results/gitlab-onboarding-checked.png' });
  const settingsMetrics = await page.context().newCDPSession(page);
  try {
    for (const width of [768, 320]) {
      await settingsMetrics.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.screenshot({ path: `test-results/source-control-onboarding-${width}.png` });
    }
  } finally {
    await settingsMetrics.send('Emulation.clearDeviceMetricsOverride');
    await settingsMetrics.detach();
  }
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'About Superfluid' })).toBeVisible();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!
      .items[0].submenu!.items.find((item) => item.label === 'Check for Updates…')!
      .click();
  });
  await expect(page.getByRole('heading', { name: 'About Superfluid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/about-updates.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open pull / merge requests', exact: true }).click();
  await page.getByRole('heading', { name: 'Merge requests', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create MR', exact: true }).click();
  const targetProject = page.getByLabel('Target project', { exact: true });
  await targetProject.waitFor();
  assert.equal(await targetProject.inputValue(), 'platform/editor');
  assert.equal(await page.getByLabel('Base branch', { exact: true }).inputValue(), 'develop');
  await targetProject.selectOption('people/fluid/editor');
  await page.locator('.modal input[value="main"]').waitFor();
  assert.equal(
    await page.getByLabel('Target project', { exact: true }).inputValue(),
    'people/fluid/editor',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await git(project, ['remote', 'rename', 'origin', 'personal']);
  await git(project, ['remote', 'add', 'work', 'git@gitlab.example.test:people/fluid/editor.git']);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByLabel('Git remote', { exact: true }).waitFor();
  await page
    .getByText('Choose a Git remote to load requests or publish this branch.', { exact: false })
    .waitFor();
  await page.screenshot({ path: 'test-results/gitlab-remote-choice.png' });
  await page.getByLabel('Git remote', { exact: true }).selectOption('work');
  await page.getByRole('heading', { name: 'Merge requests', exact: true }).waitFor();
  await page.getByRole('button', { name: /Support enterprise worktrees/ }).click();
  await page.getByRole('heading', { name: gitlabRequest.title, exact: true }).waitFor();
  await page.getByText('Ready for review.', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-summary.png' });
  const composerTrigger = page.getByRole('button', {
    name: 'Comment on merge request',
    exact: true,
  });
  const commentInput = page.getByRole('textbox', {
    name: 'Comment on this merge request',
    exact: true,
  });
  await composerTrigger.click();
  await commentInput.fill('Comment draft survives dismissal and a failed request.');
  await page.keyboard.press('Escape');
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failRead: true }),
  );
  await page.getByRole('button', { name: 'Refresh request', exact: true }).click();
  await page
    .locator('.pr-detail-error')
    .filter({ hasText: 'Refresh rejected by fixture' })
    .waitFor();
  await composerTrigger.click();
  assert.equal(
    await commentInput.inputValue(),
    'Comment draft survives dismissal and a failed request.',
  );
  await page.keyboard.press('Escape');
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failRead: false }),
  );
  await page.getByRole('button', { name: 'Refresh request', exact: true }).click();
  await page
    .locator('.pr-detail-error')
    .filter({ hasText: 'Refresh rejected by fixture' })
    .waitFor({ state: 'hidden' });
  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Timeline', exact: true })
    .click();
  await page.getByText('added 2 commits', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-timeline.png' });
  await composerTrigger.click();
  assert.equal(
    await commentInput.inputValue(),
    'Comment draft survives dismissal and a failed request.',
  );
  await page.screenshot({ path: 'test-results/gitlab-composer.png' });
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failComment: true }),
  );
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Comment rejected by fixture' }).waitFor();
  assert.equal(
    await commentInput.inputValue(),
    'Comment draft survives dismissal and a failed request.',
  );
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failComment: false }),
  );
  await commentInput.press('Meta+Enter');
  await commentInput.waitFor({ state: 'hidden' });
  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Summary', exact: true })
    .click();
  await page
    .getByText('Comment draft survives dismissal and a failed request.', { exact: true })
    .waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).commentAttempts, 2);
  await composerTrigger.click();
  assert.equal(await commentInput.inputValue(), '');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit MR', exact: true }).click();
  await page.getByLabel('MR title', { exact: true }).fill('Enterprise MR edited in Superfluid');
  await page.getByLabel('Description', { exact: true }).fill('Updated enterprise description');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Enterprise MR edited in Superfluid', exact: true })
    .waitFor();
  assert.equal(
    JSON.parse(await readFile(glState, 'utf8')).description,
    'Updated enterprise description',
  );
  await page.screenshot({ path: 'test-results/gitlab-edited.png' });
  await page.getByRole('button', { name: 'Edit MR', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('No description provided.', { exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).description, '');

  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Code', exact: true })
    .click();
  await page.locator('.pr-panel diffs-container').waitFor();
  await page.screenshot({ path: 'test-results/gitlab-code.png' });

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
  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Summary', exact: true })
    .click();
  await page.getByText('Ready for review.', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-summary-1280.png' });
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
        bounds: {
          x: 0,
          y: 0,
          width: Math.min(450, innerWidth),
          height: Math.min(650, innerHeight),
        },
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1512, 980));
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/parallel$/ })
    .click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('feature unsaved');
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
  restored.on('pageerror', (error) => errors.push(error.message));
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
  await restored
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await restored.getByRole('tab', { name: '!42', exact: true }).click();
  await restored
    .getByRole('heading', { name: 'Enterprise MR edited in Superfluid', exact: true })
    .waitFor();
  await restored.screenshot({ path: 'test-results/gitlab-restored.png' });
  const nested = join(project, 'nested-github');
  await rename(await repository(), nested);
  await git(nested, [
    'remote',
    'add',
    'origin',
    'https://github.com/superfluid-tests/fluid-lab.git',
  ]);
  await restored.getByRole('button', { name: 'Project repositories', exact: true }).click();
  const selectRepositories = restored.getByRole('button', {
    name: 'Select repositories',
    exact: true,
  });
  await selectRepositories.click();
  const repositories = restored.getByRole('dialog', { name: 'Repositories', exact: true });
  await repositories.getByRole('checkbox', { name: 'Select nested-github', exact: true }).click();
  await repositories.getByRole('checkbox', { name: 'Select root', exact: true }).click();
  await selectRepositories.click();
  await restored.keyboard.press('Escape');
  await restored.keyboard.press('Meta+Shift+P');
  await restored.getByRole('button', { name: 'Open pull / merge requests', exact: true }).click();
  await restored.getByRole('heading', { name: 'Pull requests', exact: true }).waitFor();
  await restored.getByRole('button', { name: /Keep each worktree independent/ }).click();
  await restored.getByRole('heading', { name: prFixture.title, exact: true }).waitFor();
  await restored.getByRole('button', { name: 'Edit PR', exact: true }).click();
  await restored
    .getByLabel('PR title', { exact: true })
    .fill('Nested GitHub request edited independently');
  await restored.getByRole('button', { name: 'Save changes', exact: true }).click();
  await restored
    .getByRole('heading', { name: 'Nested GitHub request edited independently', exact: true })
    .waitFor();
  await restored.getByRole('button', { name: 'Comment on pull request', exact: true }).click();
  const nestedComment = restored.getByRole('textbox', {
    name: 'Comment on this pull request',
    exact: true,
  });
  await nestedComment.fill('Nested comment stays in GitHub.');
  await restored.getByRole('button', { name: 'Comment', exact: true }).click();
  await nestedComment.waitFor({ state: 'hidden' });
  await restored
    .locator('.pr-comment')
    .filter({ hasText: 'Nested comment stays in GitHub.' })
    .waitFor();
  const githubAfter = JSON.parse(await readFile(ghState, 'utf8'));
  const gitlabAfter = JSON.parse(await readFile(glState, 'utf8'));
  assert.equal(githubAfter.title, 'Nested GitHub request edited independently');
  assert.ok(
    githubAfter.comments.some(
      (comment: { body: string }) => comment.body === 'Nested comment stays in GitHub.',
    ),
  );
  assert.equal(gitlabAfter.title, 'Enterprise MR edited in Superfluid');
  assert.ok(!JSON.stringify(gitlabAfter).includes('Nested comment stays in GitHub.'));
  await restored.screenshot({ path: 'test-results/nested-github-request.png' });
  await restored.getByRole('tab', { name: '!42', exact: true }).click();
  await restored
    .getByRole('heading', { name: 'Enterprise MR edited in Superfluid', exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
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
