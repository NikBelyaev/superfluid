import { type Page } from 'playwright';
import { expect } from 'playwright/test';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { gitlabRequest } from './hostingFixtures';
import { git } from '../apps/server/src/vcs/gitCommand';
import { repository } from './fixtures';
import { createElectronFixture } from './electronFixture';

console.time('Electron hosting');
const fixture = await createElectronFixture();
const { temp, project, prFixture, ghState, glState, errors } = fixture;

async function requestAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More request actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

let preview: Server | undefined;
let failed = false;

try {
  const page = await fixture.firstWindow();
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('.tree-row').filter({ hasText: 'main.py' }).click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('store = Store()');
  await page.getByRole('button', { name: 'New worktree', exact: true }).first().click();
  await page.getByLabel('Branch name').fill('feature/parallel');
  await page.getByLabel('Start from').fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.worktree-chip.active').filter({ hasText: 'feature/parallel' }).waitFor();
  const featureSession = await page.evaluate(async () => {
    const { projects } = await window.superfluid.call('bootstrap', {});
    const sessions = await window.superfluid.call('session.list', { projectId: projects[0].id });
    return sessions.find((s) => s.branch === 'feature/parallel')!;
  });
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('.tree-row').filter({ hasText: 'main.py' }).click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('store = Store()');
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    'from models import Store\n\n# feature unsaved\nprint(Store().count())\n',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('feature unsaved');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await page
    .getByRole('button', { name: /^Changes/ })
    .last()
    .click();
  console.timeLog('Electron hosting', 'independent worktree fixture ready');
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
  const copiedCommand = await fixture.app.evaluateHandle(({ clipboard }) => {
    const original = clipboard.writeText;
    let copied = '';
    clipboard.writeText = async (text) => {
      copied = text;
    };
    return {
      read() {
        return copied;
      },
      deny() {
        clipboard.writeText = async () => {
          throw new Error('Clipboard denied by fixture');
        };
      },
      restore() {
        clipboard.writeText = original;
      },
    };
  });
  try {
    const copyInstall = githubSettings.getByRole('button', {
      name: 'Copy gh install command',
      exact: true,
    });
    await copyInstall.click();
    await githubSettings.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    assert.equal(await copiedCommand.evaluate((state) => state.read()), 'choco install gh');
    await copiedCommand.evaluate((state) => state.deny());
    await githubSettings
      .getByRole('button', { name: 'Copy gh login command', exact: true })
      .click();
    await githubSettings.getByRole('button', { name: 'Could not copy', exact: true }).waitFor();
  } finally {
    await copiedCommand.evaluate((state) => state.restore());
    await copiedCommand.dispose();
  }
  await gitlabSettings.getByRole('row', { name: 'Pipeline Read', exact: true }).waitFor();
  await gitlabSettings.getByRole('row', { name: 'Job Read', exact: true }).waitFor();
  await gitlabSettings.getByRole('checkbox', { name: 'Git over HTTPS', exact: true }).check();
  await gitlabSettings.getByRole('row', { name: 'Code Download · Push', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/source-control-onboarding.png' });
  console.timeLog('Electron hosting', 'GitHub and source control settings checked');
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
  await fixture.app.evaluate(({ Menu }) => {
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

  console.timeLog('Electron hosting', 'GitLab request reads and writes checked');

  await fixture.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 800),
  );
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
    await fixture.app.evaluate(async ({ webContents }, url) => {
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
  await fixture.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1512, 980),
  );
  console.timeLog('Electron hosting', 'layout and native preview checked');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/parallel$/ })
    .click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('feature unsaved');
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('# newest edit must survive immediate quit\n');
  await fixture.reopen();
  assert.equal(
    await readFile(join(featureSession.path, 'main.py'), 'utf8'),
    '# newest edit must survive immediate quit\n',
  );
  const restored = await fixture.app.firstWindow();
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
  await expect(restored.locator('.recovery-banner')).toHaveCount(0);
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
  console.timeLog('Electron hosting', 'unsaved buffers and requests restored');
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
  console.timeLog('Electron hosting', 'nested repository isolation checked');
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
  console.timeLog('Electron hosting', 'island requests checked');
  await fixture.reopen();
  const reopenedRequests = await fixture.app.firstWindow();
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
  console.timeLog('Electron hosting', 'request polling and merges checked');
  console.log('Electron hosting passed:', project);
} catch (error) {
  failed = true;
  await fixture.captureFailure();
  throw error;
} finally {
  preview?.closeAllConnections();
  preview?.close();
  await fixture.dispose(failed);
  console.timeEnd('Electron hosting');
}
