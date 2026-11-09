import { _electron as electron, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { watch } from 'node:fs';
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
const jobOutput =
  '\x1b[31mFAILED tests/test_state.py\x1b[0m\nAssertionError: expected 42\n<script>plain log text</script>\n';
await writeFile(ghState, JSON.stringify(prFixture));
await writeFile(
  glState,
  JSON.stringify({
    ...gitlabRequest,
    detailed_merge_status: 'ci_must_pass',
    head_pipeline: {
      id: 12,
      project_id: 12,
      status: 'failed',
      sha: gitlabRequest.sha,
      web_url: 'https://gitlab.example.test/platform/editor/-/pipelines/12',
    },
    jobs: [
      {
        id: 20,
        name: 'compile',
        status: 'success',
        stage: 'build',
        web_url: 'https://gitlab.example.test/platform/editor/-/jobs/20',
        started_at: '2026-11-07T12:00:00Z',
        finished_at: '2026-11-07T12:00:04Z',
        duration: 4,
        allow_failure: false,
        pipeline: { id: 12 },
      },
      {
        id: 21,
        name: 'tests',
        status: 'failed',
        stage: 'test',
        web_url: 'https://gitlab.example.test/platform/editor/-/jobs/21',
        started_at: '2026-11-07T12:00:04Z',
        finished_at: '2026-11-07T12:00:13Z',
        duration: 9,
        allow_failure: false,
        pipeline: { id: 12 },
      },
    ],
    Discussions: gitlabRequest.Discussions.map((discussion) => ({
      ...discussion,
      notes: discussion.notes.map((note) =>
        note.system
          ? {
              ...note,
              body: 'added 2 commits\n\n<ul><li>6e8d826d - Preserve &lt;worktree&gt; state</li></ul>\n\n[Compare with previous version](/platform/editor/-/merge_requests/42/diffs)',
            }
          : note,
      ),
    })),
  }),
);
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
fs.appendFileSync(file+'.calls', JSON.stringify(args)+String.fromCharCode(10));
function respond() {
if(args[0] === '--version') console.log(gitlab ? 'glab 1.128.0' : 'gh version 2.80.0');
else if(args[0] === 'auth') console.log(JSON.stringify(value.signedOut ? (gitlab ? {hosts:[]} : {hosts:{}}) : gitlab ? {hosts:[{host:'gitlab.example.test',user:'fluid-dev',state:'success'}]} : {hosts:{'github.com':[{login:'fluid-dev',active:true,state:'success'}]}}));
else if(args[0] === 'repo') { if(value.denyRepository) { console.error('Project access denied by fixture'); process.exit(1); } console.log(JSON.stringify(gitlab ? {id: 11, default_branch: args[2].includes('/people/') ? 'main' : 'develop',merge_method:value.mergeSettings?.method || 'merge',squash_option:value.mergeSettings?.squash || 'default_on',forked_from_project:args[2].includes('/people/') ? {path_with_namespace:'platform/editor'} : null} : {defaultBranchRef: {name: 'main'},parent:null})); }
else if(args[1] === 'list') { const branch = args.indexOf('--source-branch'); console.log(JSON.stringify(value.filterBranch && ((branch >= 0 && args[branch+1] !== value.source_branch) || (value.state !== 'opened' && !args.includes('--all'))) ? [] : [gitlab && value.listWithoutChecks ? {...value,sha:null,head_pipeline:null,pipeline:null} : value])); }
else if(args[1] === 'view') { if(value.failRead) { console.error('Refresh rejected by fixture'); process.exit(1); } console.log(JSON.stringify(value)); }
else if(args[1] === 'merge') {
 if(value.failMerge) { console.error('Merge rejected by fixture'); process.exit(1); }
 const pin = args.indexOf(gitlab ? '--sha' : '--match-head-commit');
 if(pin < 0 || args[pin+1] !== value[gitlab ? 'sha' : 'headRefOid']) { console.error('Head changed'); process.exit(1); }
 value.mergeAttempts = (value.mergeAttempts || 0) + 1;
 if(args.includes('--disable-auto')) value.autoMergeRequest = null;
 else if(args.includes('--auto-merge=true') || args.includes('--auto')) { if(gitlab) value.merge_when_pipeline_succeeds = true; else value.autoMergeRequest = {enabledAt:'2026-11-07T14:00:00Z'}; }
 else value.state = gitlab ? 'merged' : 'MERGED';
 fs.writeFileSync(file,JSON.stringify(value));
}
else if(args[0] === 'api' && args[1].startsWith('repos/') && args[1].split('/').length === 3) console.log(JSON.stringify({allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true,allow_auto_merge:true,permissions:{push:true}}));
else if(args[0] === 'api' && args[1].endsWith('/cancel_merge_when_pipeline_succeeds')) { value.merge_when_pipeline_succeeds = false; value.mergeAttempts = (value.mergeAttempts || 0)+1; fs.writeFileSync(file,JSON.stringify(value)); console.log('{}'); }
else if(args[0] === 'api' && args[1] === 'graphql') console.log(JSON.stringify({data:{project:{mergeRequest:{diffStatsSummary:{additions:1394,deletions:544}}}}}));
else if(args[0] === 'api' && args[1].includes('/repository/commits/')) console.log(JSON.stringify([{old_path:'commit.py',new_path:'commit.py',new_file:true,deleted_file:false,diff:'@@ -0,0 +1 @@'+String.fromCharCode(10)+'+print("selected commit")'+String.fromCharCode(10)}]));
else if(args[0] === 'api' && args[1].includes('/pipelines/12/jobs')) { if(value.failJobs) { console.error('HTTP 403 insufficient_granular_scope Pipeline: Read'); process.exit(1); } console.log(JSON.stringify(value.jobs.map(job => job.status === 'failed' && value.head_pipeline.status === 'running' ? {...job,status:'running',finished_at:null,duration:null} : job))); }
else if(args[0] === 'api' && args[1].includes('/jobs/')) { if(args[1].endsWith('/trace')) { if(value.failTrace) { console.error('HTTP 403 insufficient_granular_scope Job: Read'); process.exit(1); } process.stdout.write(${JSON.stringify(jobOutput)}); } else console.log(JSON.stringify(value.jobs.find(job=>args[1].endsWith('/jobs/'+job.id)))); }
else if(args[0] === 'api') { let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => { value.description=JSON.parse(body).description;fs.writeFileSync(file,JSON.stringify(value)); }); }
else if(args[1] === 'diff') process.stdout.write(${JSON.stringify(prPatch)});
else if(args[1] === 'update' || args[1] === 'edit') {
 if(value.failUpdate) { console.error('Update rejected by fixture'); process.exit(1); }
 let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
  const title = args.indexOf('--title'); if(title >= 0) value.title = args[title+1];
  const base = args.indexOf(gitlab ? '--target-branch' : '--base'); if(base >= 0) value[gitlab ? 'target_branch' : 'baseRefName'] = args[base+1];
  if(args.includes('--draft')) value.draft = true;
  if(args.includes('--ready')) value.draft = false;
  if(args.includes('--description-file') || args.includes('--body-file')) value[gitlab ? 'description' : 'body'] = body;
  const updatedKey = gitlab ? 'updated_at' : 'updatedAt'; value[updatedKey] = new Date(Date.parse(value[updatedKey])+1000).toISOString(); fs.writeFileSync(file,JSON.stringify(value));
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
else if(args[1] === 'ready') { value.isDraft = args.includes('--undo'); fs.writeFileSync(file,JSON.stringify(value)); }
else process.exit(2);
}
const phase = args[0] === 'mr' && args[1] === 'view' ? (args.includes('--comments') ? 'discussion' : 'read') : args[1] === 'diff' ? 'diff' : args[1] === 'list' ? 'list' : null;
const gate = phase && (!value.gateRepository || process.cwd().endsWith('/'+value.gateRepository)) && value.gates?.[phase];
if (gate && !fs.existsSync(gate)) {
 fs.writeFileSync(gate+'.started', '');
 let released = false;
 const release = () => { if (released || !fs.existsSync(gate)) return; released = true; watcher.close(); respond(); };
 const watcher = fs.watch(require('node:path').dirname(gate), release);
 release();
} else respond();
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
async function requestAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More request actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

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
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('.tree-row').filter({ hasText: 'bom.py' }).waitFor();
  await page.screenshot({ path: 'test-results/editor-empty.png' });
  const firstRequest = page.getByRole('button', { name: 'Open PR #15 in Root', exact: true });
  await firstRequest.waitFor();
  const requestSkeletons = await page.evaluateHandle<{ stop: () => boolean }>(`(() => {
    let appeared = false;
    const inspect = (records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof Element &&
            (node.matches('[role="status"][aria-label="Loading request"]') ||
              node.querySelector('[role="status"][aria-label="Loading request"]'))
          )
            appeared = true;
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return {
      stop: () => {
        inspect(observer.takeRecords());
        observer.disconnect();
        return appeared;
      },
    };
  })()`);
  try {
    await firstRequest.click();
    await page
      .getByRole('heading', { name: prFixture.title, exact: true })
      .or(page.getByRole('status', { name: 'Loading request', exact: true }))
      .waitFor();
    assert.equal(await requestSkeletons.evaluate((value) => value.stop()), false);
    await page.screenshot({ path: 'test-results/pr-cold-island-open.png' });
  } finally {
    await requestSkeletons.evaluate((value) => value.stop());
    await requestSkeletons.dispose();
  }
  await page.getByRole('button', { name: 'Close #15', exact: true }).click();
  await firstRequest.click();
  await page.getByRole('heading', { name: prFixture.title, exact: true }).waitFor();
  assert.equal(await page.getByRole('status', { name: 'Loading request', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Close #15', exact: true }).click();
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
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
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
  await page.getByRole('tab', { name: 'models.py', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await page.getByRole('tab', { name: 'main.py', exact: true }).waitFor();
  await page.keyboard.press('F2');
  await page.getByLabel('New symbol name').fill('Inventory');
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to buffers', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.view-lines')?.textContent?.includes('Inventory'),
  );
  await page.keyboard.press('Meta+S');
  await page.getByRole('button', { name: 'Navigation chain from main.py', exact: true }).click();
  await page
    .getByRole('menuitem', { name: /models\.py\s*:/ })
    .first()
    .click();
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
  await page.getByRole('button', { name: 'Navigation chain from main.py', exact: true }).click();
  await page
    .getByRole('menuitem', { name: /main\.py\s*:/ })
    .first()
    .click();
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
  await page.getByRole('dialog', { name: 'Search', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/file-palette.png' });
  await page.keyboard.press('Escape');
  await page.locator('.right-group').getByRole('button', { name: 'New tab', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Pull \/ merge requests/ }).click();
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
  await page.getByRole('button', { name: 'Open MR !42 in Root', exact: true }).waitFor();
  const gates = {
    read: join(temp, 'mr-read.ready'),
    discussion: join(temp, 'mr-discussion.ready'),
    diff: join(temp, 'mr-diff.ready'),
  };
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), gates }),
  );
  await page.getByRole('button', { name: /Support enterprise worktrees/ }).click();
  await page.getByRole('status', { name: 'Loading request statistics', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-detail-skeleton.png' });
  await writeFile(gates.read, '');
  await page
    .getByRole('status', { name: 'Loading request statistics', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: gitlabRequest.title, exact: true }).waitFor();
  assert.equal(await page.locator('.pr-detail-toolbar .pr-ci').count(), 0);
  await page.locator('.pr-checks-status .pr-ci.failed').waitFor();
  assert.equal(await page.locator('.pr-detail-repository svg').count(), 0);
  assert.match(await page.locator('.pr-detail-diff-stat').innerText(), /\+1[,\s]?394/);
  assert.match(await page.locator('.pr-detail-diff-stat').innerText(), /−544/);
  await page.getByRole('status', { name: 'Loading comments', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-comments-skeleton.png' });
  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Timeline', exact: true })
    .click();
  await page.getByRole('status', { name: 'Loading timeline', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-timeline-skeleton.png' });
  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Summary', exact: true })
    .click();
  await writeFile(gates.discussion, '');
  await page.getByText('Ready for review.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enable auto-merge', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-summary.png' });
  await page.locator('.pr-timeline-events .timeline-item').first().waitFor({ state: 'attached' });
  const detailCalls = async () =>
    (await readFile(glState + '.calls', 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
      .filter((args) => args[0] === 'mr' && ['view', 'diff'].includes(args[1]));
  const traceCalls = async () =>
    (await readFile(glState + '.calls', 'utf8'))
      .split('\n')
      .filter((line) => line.includes('/trace'));
  assert.equal((await traceCalls()).length, 0);
  const ciBadge = page
    .locator('.pr-checks-status')
    .getByRole('button', { name: '1 failed checks', exact: true });
  await ciBadge.hover();
  const checksPopover = page.getByRole('dialog', {
    name: 'Some checks were not successful',
    exact: true,
  });
  await checksPopover.getByText('1 of 2 failed', { exact: true }).waitFor();
  await checksPopover.getByText('tests', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/ci-hover.png' });
  await checksPopover.getByRole('button', { name: 'Show all', exact: true }).click();
  const job = page
    .locator('.pr-job')
    .filter({ has: page.locator('summary').filter({ hasText: /^tests/ }) });
  await job.locator('summary').click();
  const output = job.getByLabel('tests output', { exact: true });
  await output.waitFor();
  assert.ok((await output.innerText()).includes('AssertionError: expected 42'));
  assert.ok((await output.innerText()).includes('<script>plain log text</script>'));
  assert.ok(!(await output.innerText()).includes('\x1b'));
  await page.screenshot({ path: 'test-results/ci-job-output.png' });
  assert.equal((await traceCalls()).length, 1);
  const ciTabs = page.getByRole('tablist', { name: 'Merge request', exact: true });
  await ciTabs.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await ciTabs.getByRole('tab', { name: 'Summary', exact: true }).click();
  await job.locator('pre').waitFor();
  assert.equal(await job.getAttribute('open'), '');
  assert.equal((await traceCalls()).length, 1);
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failTrace: true }),
  );
  await job.getByRole('button', { name: 'Refresh tests output', exact: true }).click();
  await job.getByRole('alert').filter({ hasText: 'Job: Read' }).waitFor();
  assert.ok((await output.innerText()).includes('AssertionError: expected 42'));
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failTrace: false }),
  );
  await job.getByRole('button', { name: 'Refresh tests output', exact: true }).click();
  await job.getByRole('alert').waitFor({ state: 'detached' });
  await job.locator('.pr-job-output[aria-busy="false"]').waitFor();
  const jobTraces = (await traceCalls()).length;
  const beforeTabs = await detailCalls();
  assert.equal(beforeTabs.filter((args) => args[1] === 'diff').length, 0);
  const description = page.locator('.pr-summary .pr-section').first();
  await description.locator('summary').click();
  const mergeRequestTabs = page.getByRole('tablist', { name: 'Merge request', exact: true });
  await mergeRequestTabs.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await page.getByText('added 2 commits', { exact: true }).waitFor();
  await mergeRequestTabs.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByRole('status', { name: 'Loading diff', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-code-skeleton.png' });
  await writeFile(gates.diff, '');
  await page.locator('.pr-panel diffs-container').waitFor();
  const afterCode = await detailCalls();
  assert.equal(afterCode.filter((args) => args[1] === 'view').length, beforeTabs.length);
  assert.equal(afterCode.filter((args) => args[1] === 'diff').length, 1);
  const parsedDiff = await page.locator('.pr-panel diffs-container').elementHandle();
  assert.ok(parsedDiff);
  await mergeRequestTabs.getByRole('tab', { name: 'Summary', exact: true }).click();
  assert.equal(await description.getAttribute('open'), null);
  await description.locator('summary').click();
  await mergeRequestTabs.getByRole('tab', { name: 'Code', exact: true }).click();
  assert.equal(await parsedDiff.evaluate((element) => element.isConnected), true);
  assert.deepEqual(await detailCalls(), afterCode);
  assert.equal((await traceCalls()).length, jobTraces);
  await mergeRequestTabs.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await page.locator('.island-request .pr-ci').hover();
  await checksPopover.getByRole('button', { name: 'Show all', exact: true }).click();
  await page
    .getByRole('tab', { name: 'Summary', exact: true })
    .and(page.locator('[aria-selected="true"]'))
    .waitFor();
  await job.locator('pre').waitFor();
  assert.equal((await traceCalls()).length, jobTraces);
  await mergeRequestTabs.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.getByRole('button', { name: 'Edit target branch', exact: true }).click();
  const baseInput = page.getByRole('textbox', { name: 'Target branch', exact: true });
  await baseInput.fill('canceled-target');
  await baseInput.press('Escape');
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).target_branch, 'develop');
  await page.getByRole('button', { name: 'Edit target branch', exact: true }).click();
  await baseInput.fill('release/test');
  await page.screenshot({ path: 'test-results/gitlab-base-inline-edit.png' });
  await baseInput.press('Enter');
  await page
    .getByRole('button', { name: 'Edit target branch', exact: true })
    .getByText('release/test', { exact: true })
    .waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).target_branch, 'release/test');
  await page.screenshot({ path: 'test-results/gitlab-base-retargeted.png' });
  await mergeRequestTabs.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.pr-panel diffs-container').waitFor();
  assert.equal(await parsedDiff.evaluate((element) => element.isConnected), false);
  assert.equal((await detailCalls()).filter((args) => args[1] === 'diff').length, 2);
  await mergeRequestTabs.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.getByRole('button', { name: 'Edit title', exact: true }).click();
  const titleInput = page.getByRole('textbox', { name: 'Title', exact: true });
  await titleInput.fill('Canceled title');
  await titleInput.press('Escape');
  await page.getByRole('heading', { name: gitlabRequest.title, exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).title, gitlabRequest.title);
  await page.getByRole('button', { name: 'Edit title', exact: true }).click();
  await titleInput.fill('Enterprise inline title');
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failUpdate: true }),
  );
  await titleInput.press('Enter');
  await page
    .locator('.pr-inline-error')
    .filter({ hasText: 'Update rejected by fixture' })
    .waitFor();
  assert.equal(await titleInput.inputValue(), 'Enterprise inline title');
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), failUpdate: false }),
  );
  await titleInput.press('Enter');
  await page.getByRole('heading', { name: 'Enterprise inline title', exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).title, 'Enterprise inline title');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const descriptionInput = page.getByRole('textbox', { name: 'Description', exact: true });
  await descriptionInput.fill('Inline description');
  await descriptionInput.press('Shift+Enter');
  await descriptionInput.pressSequentially('Second line');
  assert.equal(await descriptionInput.inputValue(), 'Inline description\nSecond line');
  await page.screenshot({ path: 'test-results/gitlab-inline-edit.png' });
  await mergeRequestTabs.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await page.locator('.pr-inline-description .pr-inline-editor').waitFor({ state: 'detached' });
  assert.equal(
    JSON.parse(await readFile(glState, 'utf8')).description,
    'Inline description\nSecond line',
  );
  await mergeRequestTabs.getByRole('tab', { name: 'Summary', exact: true }).click();
  const currentPipeline = JSON.parse(await readFile(glState, 'utf8')).head_pipeline;
  const currentJobs = JSON.parse(await readFile(glState, 'utf8')).jobs;
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      head_pipeline: { ...currentPipeline, status: 'running' },
    }),
  );
  await requestAction(page, 'Refresh request');
  await page.locator('.pr-checks-status .pr-ci.pending').waitFor();
  await page.locator('.pr-checks-status .pr-ci').getByText('1/2 checks', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/ci-progress.png' });
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      jobs: currentJobs.map((job: { status: string }) => ({ ...job, status: 'running' })),
    }),
  );
  await requestAction(page, 'Refresh request');
  await page.locator('.pr-checks-status .pr-ci').getByText('0/2 checks', { exact: true }).waitFor();
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      jobs: currentJobs.map((job: { status: string }) => ({ ...job, status: 'success' })),
    }),
  );
  await requestAction(page, 'Refresh request');
  await page
    .locator('.pr-checks-status .pr-ci.pending')
    .getByText('Pipeline running', { exact: true })
    .waitFor();
  await page.screenshot({ path: 'test-results/ci-downstream-running.png' });
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      head_pipeline: currentPipeline,
      jobs: currentJobs,
    }),
  );
  await requestAction(page, 'Refresh request');
  await page.locator('.pr-checks-status .pr-ci.failed').waitFor();
  await mergeRequestTabs.getByRole('tab', { name: 'Summary', exact: true }).click();
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
  await requestAction(page, 'Refresh request');
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
  await requestAction(page, 'Refresh request');
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
  await page
    .getByRole('button', { name: '6e8d826d Preserve <worktree> state', exact: true })
    .click();
  await page.locator('.pr-commit-scope').filter({ hasText: '6e8d826d' }).waitFor();
  await page.locator('.pr-panel diffs-container').waitFor();
  const commitPatch = await page.evaluate(async () => {
    const container = document.querySelector('.pr-panel diffs-container');
    return container?.shadowRoot?.textContent ?? container?.textContent;
  });
  assert.ok(commitPatch?.includes('selected commit'));
  assert.ok(!commitPatch?.includes('Inventory'));
  await page.screenshot({ path: 'test-results/gitlab-commit-diff.png' });
  await page.getByRole('button', { name: 'All changes', exact: true }).click();
  await page.locator('.pr-panel diffs-container').waitFor();
  await mergeRequestTabs.getByRole('tab', { name: 'Timeline', exact: true }).click();
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
  assert.equal(await page.getByRole('button', { name: 'Edit MR', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Edit title', exact: true }).click();
  await titleInput.fill('Enterprise MR edited in Superfluid');
  await titleInput.press('Enter');
  await page
    .getByRole('heading', { name: 'Enterprise MR edited in Superfluid', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await descriptionInput.fill('Updated enterprise description');
  await descriptionInput.press('Enter');
  await page.locator('.pr-inline-description .pr-inline-editor').waitFor({ state: 'detached' });
  assert.equal(
    JSON.parse(await readFile(glState, 'utf8')).description,
    'Updated enterprise description',
  );
  await page.screenshot({ path: 'test-results/gitlab-edited.png' });
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await descriptionInput.fill('');
  await descriptionInput.press('Enter');
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
  await page
    .getByRole('tablist', { name: 'Merge request', exact: true })
    .getByRole('tab', { name: 'Summary', exact: true })
    .click();
  await page.getByText('Ready for review.', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/gitlab-summary-1280.png' });
  await page.getByRole('button', { name: 'Toggle right panel', exact: true }).click();
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
    .getByRole('button', { name: 'Toggle right panel', exact: true })
    .boundingBox();
  assert.ok(hideSurface && hideSurface.x + hideSurface.width <= geometry.viewportWidth);
  await page.screenshot({ path: 'test-results/workspace-1280.png' });
  await page.getByRole('button', { name: 'Collapse actions', exact: true }).click();
  await page.getByRole('button', { name: 'Expand actions', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle right panel', exact: true }).click();
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
  await restored.getByRole('button', { name: 'Edit title', exact: true }).click();
  await restored
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Nested GitHub request edited independently');
  await restored.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
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
  const unselected = join(project, 'nested-gitlab');
  await rename(await repository(), unselected);
  await git(unselected, ['checkout', '-b', 'task/requests']);
  await git(unselected, [
    'remote',
    'add',
    'origin',
    'git@gitlab.example.test:people/fluid/editor.git',
  ]);
  await git(project, ['checkout', '--detach']);
  const islandRequest = restored.getByRole('button', {
    name: 'Open MR !42 in nested-gitlab',
    exact: true,
  });
  await restored.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await selectRepositories.click();
  await restored.getByRole('checkbox', { name: 'Select nested-gitlab', exact: true }).waitFor();
  await selectRepositories.click();
  await restored.keyboard.press('Escape');
  await restored.locator('.island-requests[aria-busy="false"]').waitFor({ state: 'attached' });
  assert.equal(await islandRequest.count(), 0);
  const unselectedCalls: string[][] = (await readFile(glState + '.calls', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(
    unselectedCalls.filter(
      (args) => args[0] === 'mr' && args[1] === 'list' && args.includes('task/requests'),
    ).length,
    0,
  );
  const islandGates = {
    read: join(temp, 'island-ci.ready'),
    list: join(temp, 'island-list.ready'),
  };
  await writeFile(islandGates.list, '');
  const slowList = join(temp, 'slow-repository-list.ready');
  await writeFile(
    ghState,
    JSON.stringify({ ...JSON.parse(await readFile(ghState, 'utf8')), gates: { list: slowList } }),
  );
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      source_branch: 'task/requests',
      filterBranch: true,
      gates: islandGates,
      gateRepository: 'nested-gitlab',
      listWithoutChecks: true,
    }),
  );
  await restored.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await selectRepositories.click();
  await restored.getByRole('checkbox', { name: 'Select nested-gitlab', exact: true }).click();
  await selectRepositories.click();
  await restored.keyboard.press('Escape');
  await restored.screenshot({ path: 'test-results/island-requests-before.png' });
  await islandRequest.waitFor();
  assert.equal(await restored.locator('.island-requests').getAttribute('aria-busy'), 'true');
  await restored.screenshot({ path: 'test-results/island-before-ci.png' });
  await islandRequest.click();
  await restored
    .getByRole('heading', { name: 'Enterprise MR edited in Superfluid', exact: true })
    .waitFor();
  assert.equal(
    await restored.getByRole('status', { name: 'Loading request', exact: true }).count(),
    0,
  );
  await restored.getByRole('status', { name: 'Loading request statistics', exact: true }).waitFor();
  await restored.screenshot({ path: 'test-results/island-request-preview.png' });
  await writeFile(islandGates.read, '');
  await islandRequest.locator('..').locator('.pr-ci.failed').waitFor();
  await islandRequest.locator('..').locator('.pr-ci.failed').hover();
  await restored.locator('.pr-ci-popover').getByText('tests', { exact: true }).waitFor();
  await restored.keyboard.press('Escape');
  await writeFile(slowList, '');
  await restored.locator('.island-requests[aria-busy="false"]').waitFor({ state: 'attached' });
  await restored.screenshot({ path: 'test-results/island-requests.png' });
  await islandRequest.click();
  await restored
    .getByRole('heading', { name: 'Enterprise MR edited in Superfluid', exact: true })
    .waitFor();
  await requestAction(restored, 'Repository requests');
  const requestRepository = restored.getByLabel('Request repository', { exact: true });
  await requestRepository.selectOption({ label: 'Root' });
  await restored.getByRole('heading', { name: 'Merge requests', exact: true }).waitFor();
  assert.equal(
    await restored.getByLabel('Request scope', { exact: true }).inputValue(),
    'repository',
  );
  await requestRepository.selectOption({ label: 'nested-gitlab' });
  await restored.getByRole('button', { name: /Support enterprise|Enterprise MR edited/ }).waitFor();
  await restored.screenshot({ path: 'test-results/request-repository-picker.png' });
  await restored.locator('.island-requests[aria-busy="false"]').waitFor({ state: 'attached' });
  await git(unselected, ['checkout', 'main']);
  await restored.evaluate(() => window.dispatchEvent(new Event('focus')));
  await islandRequest.waitFor({ state: 'hidden' });
  await restored.locator('.island-requests[aria-busy="false"]').waitFor({ state: 'attached' });
  await git(unselected, ['checkout', 'task/requests']);
  await restored.evaluate(() => window.dispatchEvent(new Event('focus')));
  await islandRequest.waitFor();
  await restored.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await selectRepositories.click();
  assert.equal(
    await restored.getByRole('checkbox', { name: 'Select nested-gitlab', exact: true }).isChecked(),
    true,
  );
  await restored.getByRole('checkbox', { name: 'Select nested-gitlab', exact: true }).click();
  await islandRequest.waitFor({ state: 'hidden' });
  await restored.getByRole('checkbox', { name: 'Select nested-gitlab', exact: true }).click();
  await islandRequest.waitFor();
  await selectRepositories.click();
  await restored.keyboard.press('Escape');
  await restored
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/parallel$/ })
    .click();
  await islandRequest.waitFor({ state: 'hidden' });
  await restored
    .locator('.worktree-chip')
    .filter({ hasText: /^Detached HEAD$/ })
    .click();
  await islandRequest.waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  await closeApp();
  app = await electron.launch({ executablePath, args: launchArgs, env: launchEnv });
  captureNativeOutput();
  const reopenedRequests = await app.firstWindow();
  reopenedRequests.on('pageerror', (error) => errors.push(error.message));
  await reopenedRequests
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await reopenedRequests
    .getByRole('button', { name: 'Open MR !42 in nested-gitlab', exact: true })
    .waitFor();
  await reopenedRequests.clock.install();
  await reopenedRequests.reload();
  await reopenedRequests
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  const polledRequest = reopenedRequests.getByRole('button', {
    name: 'Open MR !42 in nested-gitlab',
    exact: true,
  });
  const requestsSettled = reopenedRequests.locator('.island-requests[aria-busy="false"]');
  await polledRequest.waitFor();
  await requestsSettled.waitFor({ state: 'attached' });
  await reopenedRequests.screenshot({ path: 'test-results/island-requests-quiet.png' });
  const openRequest = JSON.parse(await readFile(glState, 'utf8'));
  await writeFile(glState, JSON.stringify({ ...openRequest, state: 'merged' }));
  await reopenedRequests.clock.fastForward(60_000);
  await polledRequest.waitFor({ state: 'hidden' });
  await requestsSettled.waitFor({ state: 'attached' });
  await reopenedRequests.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await writeFile(glState, JSON.stringify(openRequest));
  await reopenedRequests.clock.fastForward(60_000);
  assert.equal(await polledRequest.count(), 0);
  await reopenedRequests.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await polledRequest.waitFor();
  await reopenedRequests.clock.resume();
  await polledRequest.click();
  await reopenedRequests.getByRole('button', { name: 'Enable auto-merge', exact: true }).waitFor();
  assert.equal(await reopenedRequests.locator('.pr-detail-toolbar .pr-ci').count(), 0);
  await reopenedRequests.getByRole('button', { name: 'Enable auto-merge', exact: true }).click();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).mergeAttempts ?? 0, 0);
  await reopenedRequests.getByRole('button', { name: 'Confirm auto-merge?', exact: true }).click();
  await reopenedRequests.locator('.pr-merge-state.auto').waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).merge_when_pipeline_succeeds, true);
  await requestAction(reopenedRequests, 'Cancel auto-merge');
  await reopenedRequests.getByRole('button', { name: 'Confirm cancel?', exact: true }).click();
  await reopenedRequests.getByRole('button', { name: 'Enable auto-merge', exact: true }).waitFor();
  const mergeFixture = JSON.parse(await readFile(glState, 'utf8'));
  const refreshListGate = join(temp, 'island-refresh.ready');
  const listRequested = new Promise<void>((resolve) => {
    const watcher = watch(temp, (_event, name) => {
      if (name !== 'island-refresh.ready.started') return;
      watcher.close();
      resolve();
    });
  });
  await writeFile(
    glState,
    JSON.stringify({ ...mergeFixture, draft: true, gates: { list: refreshListGate } }),
  );
  await requestAction(reopenedRequests, 'Refresh request');
  await reopenedRequests.getByRole('button', { name: 'Ready for review', exact: true }).click();
  await listRequested;
  assert.equal(await polledRequest.isVisible(), true);
  await reopenedRequests.screenshot({ path: 'test-results/island-during-refresh.png' });
  await writeFile(refreshListGate, '');
  await requestsSettled.waitFor({ state: 'attached' });
  await reopenedRequests.getByRole('button', { name: 'Enable auto-merge', exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).draft, false);
  await writeFile(
    glState,
    JSON.stringify({
      ...JSON.parse(await readFile(glState, 'utf8')),
      has_conflicts: true,
      detailed_merge_status: 'conflict',
    }),
  );
  await requestAction(reopenedRequests, 'Refresh request');
  const conflicts = reopenedRequests.getByRole('button', { name: 'Conflicts', exact: true });
  await conflicts.waitFor();
  assert.equal(await conflicts.getAttribute('aria-disabled'), 'true');
  await reopenedRequests.screenshot({ path: 'test-results/merge-conflicts.png' });
  const readyFixture = JSON.parse(await readFile(glState, 'utf8'));
  await writeFile(
    glState,
    JSON.stringify({
      ...readyFixture,
      has_conflicts: false,
      detailed_merge_status: 'mergeable',
      head_pipeline: { ...readyFixture.head_pipeline, status: 'success' },
      jobs: readyFixture.jobs.map((job: { status: string }) => ({ ...job, status: 'success' })),
    }),
  );
  await requestAction(reopenedRequests, 'Refresh request');
  await reopenedRequests.getByRole('button', { name: 'Squash and merge', exact: true }).waitFor();
  await reopenedRequests.getByRole('button', { name: 'More request actions', exact: true }).click();
  await reopenedRequests.screenshot({ path: 'test-results/merge-menu.png' });
  await reopenedRequests.getByRole('menuitemradio', { name: 'Merge', exact: true }).click();
  await reopenedRequests.getByRole('button', { name: 'Merge', exact: true }).click();
  await writeFile(
    glState,
    JSON.stringify({ ...JSON.parse(await readFile(glState, 'utf8')), sha: 'b'.repeat(40) }),
  );
  await reopenedRequests.getByRole('button', { name: 'Confirm merge?', exact: true }).click();
  await reopenedRequests.getByRole('alert').filter({ hasText: 'head changed' }).waitFor();
  const changedHead = reopenedRequests.getByRole('button', { name: 'Head changed', exact: true });
  await changedHead.waitFor();
  assert.equal(await changedHead.getAttribute('aria-disabled'), 'true');
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).mergeAttempts, 2);
  await requestAction(reopenedRequests, 'Refresh request');
  await reopenedRequests.getByRole('button', { name: 'Merge', exact: true }).click();
  await reopenedRequests.getByRole('button', { name: 'Confirm merge?', exact: true }).click();
  await reopenedRequests.locator('.pr-merge-state.merged').waitFor();
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).state, 'merged');
  await reopenedRequests.screenshot({ path: 'test-results/merge-completed.png' });
  await reopenedRequests.getByRole('tab', { name: '#15', exact: true }).last().click();
  await reopenedRequests.getByRole('button', { name: 'Merge', exact: true }).waitFor();
  await reopenedRequests.getByRole('button', { name: 'More request actions', exact: true }).click();
  await reopenedRequests
    .getByRole('menuitemradio', { name: 'Rebase and merge', exact: true })
    .click();
  await reopenedRequests.getByRole('button', { name: 'Rebase and merge', exact: true }).click();
  assert.equal(JSON.parse(await readFile(ghState, 'utf8')).mergeAttempts ?? 0, 0);
  await reopenedRequests.getByRole('button', { name: 'Confirm merge?', exact: true }).click();
  await reopenedRequests.locator('.pr-merge-state.merged').waitFor();
  assert.equal(JSON.parse(await readFile(ghState, 'utf8')).state, 'MERGED');
  assert.equal(JSON.parse(await readFile(glState, 'utf8')).mergeAttempts, 3);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Electron smoke passed:', project);
} catch (e) {
  failed = true;
  const page = await app.firstWindow();
  await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
  console.error('Electron fixture:', temp);
  console.error('Error toasts:', await page.locator('.toast').allTextContents());
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
