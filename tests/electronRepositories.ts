import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { repository, temp } from './fixtures';
import { git } from '../apps/server/src/vcs/gitCommand';

const directory = await temp();
const project = await repository();
const monorepo = await repository();
const remote = await temp();
await git(remote, ['init', '--bare']);
await git(monorepo, ['branch', 'stage']);
await git(monorepo, ['remote', 'add', 'origin', 'https://github.com/example/fixture.git']);
await mkdir(join(project, 'apps'));
await writeFile(join(project, '.gitignore'), 'apps/\n');
await git(project, ['add', '.gitignore']);
await git(project, ['commit', '-m', 'Ignore nested repositories']);
await git(project, ['checkout', '--detach']);
const names = ['core', 'framework', 'web-backend'];
for (const name of names) {
  const path = join(project, 'apps', name);
  await rename(await repository(), path);
  if (name !== 'framework') await git(path, ['branch', 'stage']);
  await git(path, ['update-ref', 'refs/remotes/origin/production', 'HEAD']);
  const origin = name === 'core' ? remote : await temp();
  if (name !== 'core') await git(origin, ['init', '--bare']);
  await git(path, ['remote', 'add', 'origin', origin]);
}
const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
environment.SF_DATA_DIR = join(directory, 'data');
environment.SF_TEST = '1';
delete environment.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.SF_EXECUTABLE || createRequire(import.meta.url)('electron');
const args = process.env.SF_EXECUTABLE ? [] : [resolve('.')];
let app = await electron.launch({
  executablePath,
  args: [...args, '--project=' + project],
  env: environment,
});
await mkdir('test-results', { recursive: true });
const errors: string[] = [];

try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: basename(project) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Project repositories', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Branches and repositories', exact: true });
  await panel.waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Choose an action', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await panel.getByLabel('Switch branch', { exact: true }).inputValue(), '');
  assert.equal(await panel.getByLabel('New branch name', { exact: true }).count(), 1);
  const chips = panel.getByRole('button', { name: 'Select repositories', exact: true });
  await chips.click();
  const repositories = page.getByRole('dialog', { name: 'Repositories', exact: true });
  await repositories.waitFor();
  await chips.click();
  await repositories.waitFor({ state: 'hidden' });
  await chips.click();
  await repositories.getByLabel('Find repository').fill('framework');
  assert.equal(await repositories.getByRole('checkbox').count(), 1);
  await repositories.getByRole('checkbox', { name: 'Select apps/framework', exact: true }).click();
  await repositories.getByLabel('Find repository').fill('web-backend');
  await repositories
    .getByRole('checkbox', { name: 'Select apps/web-backend', exact: true })
    .click();
  await chips.click();
  assert.match(await chips.innerText(), /core[\s\S]*framework[\s\S]*\+1/);
  await panel.getByRole('button', { name: 'Choose Switch branch', exact: true }).click();
  await page.getByRole('option', { name: 'stage', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Local', exact: true }).count(), 1);
  await page.screenshot({ path: 'test-results/repository-groups-expanded.png' });
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('option', { name: 'stage', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('input[aria-label="Switch branch"]').press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(
    await panel.getByLabel('Switch branch', { exact: true }).inputValue(),
    'origin/production',
  );
  await panel.getByRole('button', { name: 'Choose Switch branch', exact: true }).click();
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  assert.equal(await page.getByRole('option').count(), 0);
  const remoteGroup = page.getByRole('button', { name: 'Remote', exact: true });
  await remoteGroup.focus();
  await remoteGroup.press('Enter');
  await page.getByRole('option', { name: 'origin/production', exact: true }).waitFor();
  await remoteGroup.press('Space');
  await page
    .getByRole('option', { name: 'origin/production', exact: true })
    .waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/repository-groups-collapsed.png' });
  await page.locator('input[aria-label="Switch branch"]').fill('stage');
  await page.getByRole('option', { name: 'stage', exact: true }).click();
  await panel
    .getByRole('status')
    .filter({ hasText: 'Branch “stage” is missing in apps/framework.' })
    .waitFor();
  assert.equal(
    await panel.getByRole('button', { name: 'Switch · 3', exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({ path: 'test-results/repositories-empty.png' });
  await panel.getByLabel('New branch name').fill('task/abandoned');
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Choose Switch branch', exact: true }).click();
  await page.getByRole('option', { name: 'main', exact: true }).waitFor();
  assert.equal(await page.locator('input[aria-label="New branch name"]').inputValue(), '');
  await page.getByRole('option', { name: 'main', exact: true }).click();
  assert.equal(await panel.getByLabel('New branch name').inputValue(), '');
  await panel.getByLabel('New branch name').fill('task/keyboard');
  await page.keyboard.press('Escape');
  await page.locator('input[aria-label="Switch branch"]').press('ArrowDown');
  await page.getByRole('option', { name: 'main', exact: true }).waitFor();
  assert.equal(await page.locator('input[aria-label="New branch name"]').inputValue(), '');
  await page.keyboard.press('Escape');
  assert.equal(
    await panel.getByRole('button', { name: 'Choose an action', exact: true }).isDisabled(),
    true,
  );
  await panel.getByLabel('New branch name').fill('task/multi-repo');
  await page.screenshot({ path: 'test-results/repository-creation-options.png' });
  await page.getByRole('option', { name: 'Create branch task/multi-repo', exact: true }).click();
  await panel.getByRole('button', { name: 'Create & switch · 3', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  for (const name of names)
    assert.equal(
      (await git(join(project, 'apps', name), ['branch', '--show-current'])).trim(),
      'task/multi-repo',
    );
  assert.equal((await git(project, ['branch', '--show-current'])).trim(), '');
  await page.screenshot({ path: 'test-results/repositories-created.png' });
  await page.getByRole('button', { name: 'Project repositories', exact: true }).screenshot({
    path: 'test-results/repositories-island-branch.png',
  });
  await page.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await panel.getByLabel('New branch name').fill('main');
  await page.keyboard.press('Escape');
  await panel.screenshot({ path: 'test-results/repository-existing-branch.png' });
  await panel.getByRole('button', { name: 'Switch', exact: true }).click();
  assert.equal(await panel.getByLabel('Switch branch', { exact: true }).inputValue(), 'main');
  assert.equal(await panel.getByLabel('New branch name').inputValue(), '');
  assert.equal(
    (await git(join(project, 'apps/core'), ['branch', '--show-current'])).trim(),
    'task/multi-repo',
  );
  await panel.getByRole('button', { name: 'Choose Switch branch', exact: true }).click();
  await page.getByRole('option', { name: 'main', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('option', { name: 'origin/production', exact: true }).count(),
    1,
  );
  await page.getByRole('option', { name: 'main', exact: true }).click();
  await panel.getByRole('button', { name: 'Switch · 3', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  for (const name of names)
    assert.equal(
      (await git(join(project, 'apps', name), ['branch', '--show-current'])).trim(),
      'main',
    );

  await writeFile(join(project, 'apps/core/main.py'), 'print("updated")\n');
  await writeFile(join(project, 'apps/core/added.py'), 'print("new")\n');
  await writeFile(join(project, 'apps/framework/main.py'), 'print("not selected")\n');
  await page.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await chips.click();
  await repositories.getByRole('checkbox', { name: 'Select apps/framework', exact: true }).click();
  await repositories
    .getByRole('checkbox', { name: 'Select apps/web-backend', exact: true })
    .click();
  await chips.click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  await page
    .locator('[role="menuitem"]:not([data-disabled])')
    .filter({ hasText: /^Commit$/ })
    .waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'Push', exact: true }).isDisabled(), true);
  assert.equal(
    await page.getByRole('menuitem', { name: 'Create PR', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('menu').screenshot({ path: 'test-results/git-actions-dirty.png' });
  await page.getByRole('menuitem', { name: 'Commit', exact: true }).focus();
  await page.keyboard.press('End');
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Apply stash', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole('menuitem', { name: 'Stash', exact: true }).click();
  await page.getByRole('button', { name: /Stash completed/ }).waitFor();
  assert.equal(await git(join(project, 'apps/core'), ['diff']), '');
  await assert.rejects(readFile(join(project, 'apps/core/added.py')), /ENOENT/);
  assert.match(await git(join(project, 'apps/framework'), ['diff']), /not selected/);
  await page.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Apply stash', exact: true }).click();
  await page.getByRole('button', { name: /Apply stash completed/ }).waitFor();
  assert.equal(await readFile(join(project, 'apps/core/added.py'), 'utf8'), 'print("new")\n');
  await page.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Commit', exact: true }).click();
  await panel.getByLabel('Commit message').fill('Update selected core');
  await page.screenshot({ path: 'test-results/repositories-commit-composer.png' });
  await panel.getByRole('button', { name: 'Commit selected', exact: true }).click();
  await page.getByRole('button', { name: /Commit completed/ }).waitFor();
  assert.equal(
    (await git(join(project, 'apps/core'), ['log', '-1', '--format=%s'])).trim(),
    'Update selected core',
  );
  for (const name of ['framework', 'web-backend'])
    assert.equal(
      (await git(join(project, 'apps', name), ['log', '-1', '--format=%s'])).trim(),
      'Initial',
    );

  assert.equal(await git(join(project, 'apps/core'), ['show', 'HEAD:added.py']), 'print("new")\n');
  assert.match(await git(join(project, 'apps/framework'), ['diff']), /not selected/);
  await page.getByRole('button', { name: 'Push', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  await page.getByRole('menu').waitFor();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), [
    'Commit',
    'Push',
    'Create PR',
    'Stash',
    'Apply stash',
  ]);
  await page.getByRole('menu').screenshot({ path: 'test-results/git-actions-unknown.png' });
  await page.getByRole('menuitem', { name: 'Push', exact: true }).click();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(await panel.isVisible(), false);
  await page.getByRole('button', { name: /Push completed/ }).waitFor();
  assert.equal(
    (await git(remote, ['rev-parse', 'refs/heads/main'])).trim(),
    (await git(join(project, 'apps/core'), ['rev-parse', 'HEAD'])).trim(),
  );

  await page.locator('.repository-operation[aria-disabled="true"]').waitFor();
  await page.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  for (const name of ['Commit', 'Push', 'Create PR']) {
    await page.getByRole('menuitem', { name, exact: true }).waitFor();
    assert.equal(await page.getByRole('menuitem', { name, exact: true }).isDisabled(), true);
  }
  await page.getByRole('menu').screenshot({ path: 'test-results/git-actions-synced.png' });
  await page.keyboard.press('Escape');

  const bootstrap = await page.evaluate(() => window.superfluid.call('bootstrap', {}));
  const record = bootstrap.projects.find(
    (p) => p.path === project || p.name === basename(project),
  )!;
  const source = (
    await page.evaluate(
      (projectId) => window.superfluid.call('session.list', { projectId }),
      record.id,
    )
  )[0];
  const run = await page.evaluate(
    (sessionId) =>
      window.superfluid.call('terminal.run', { sessionId, command: 'cat', name: 'Source process' }),
    source.id,
  );
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('.tree-row[data-path="apps"]').click();
  await page.locator('.tree-row[data-path="apps/core"]').click();
  await page.locator('.tree-row[data-path="apps/core/main.py"]').click();
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('# source unsaved\n');
  await page.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await chips.click();
  await repositories.getByRole('checkbox', { name: 'Select apps/framework', exact: true }).click();
  await repositories
    .getByRole('checkbox', { name: 'Select apps/web-backend', exact: true })
    .click();
  await chips.click();
  await page.getByRole('button', { name: 'Commit, push & PR', exact: true }).waitFor();
  await panel.getByLabel('New branch name').fill('task/tree');
  await page.getByRole('option', { name: 'Create worktree task/tree', exact: true }).click();
  assert.equal(await panel.getByLabel('New branch name').inputValue(), 'task/tree');
  await page.screenshot({ path: 'test-results/repositories-worktree.png' });
  await panel.getByRole('button', { name: 'Create worktree · 3', exact: true }).click();
  await page
    .locator('.worktree-chip.active')
    .filter({ hasText: /^task\/tree$/ })
    .waitFor();
  const sessions = await page.evaluate(
    (projectId) => window.superfluid.call('session.list', { projectId }),
    record.id,
  );
  const created = sessions.find((s) => s.branch === 'task/tree')!;
  assert.ok(created?.repositoryWorktree);
  for (const name of names) {
    assert.equal(
      (await git(join(created.path, 'apps', name), ['branch', '--show-current'])).trim(),
      'task/tree',
    );
    assert.equal(
      (await git(join(project, 'apps', name), ['branch', '--show-current'])).trim(),
      'main',
    );
  }
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^Detached HEAD$/ })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('.view-lines')
      ?.textContent?.replaceAll('\u00a0', ' ')
      .includes('source unsaved'),
  );
  assert.equal(
    (await page.evaluate(() => window.superfluid.call('bootstrap', {}))).runs.find(
      (r) => r.id === run.id,
    )?.state,
    'running',
  );
  await app.close();
  app = await electron.launch({ executablePath, args, env: environment });
  const reopened = await app.firstWindow();
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened
    .getByRole('button', { name: basename(project) })
    .first()
    .click();
  await reopened
    .locator('.worktree-chip')
    .filter({ hasText: /^task\/tree$/ })
    .click();
  await reopened.getByRole('button', { name: 'Project repositories', exact: true }).click();
  const restoredPanel = reopened.getByRole('dialog', {
    name: 'Branches and repositories',
    exact: true,
  });
  assert.equal(
    await restoredPanel.getByRole('button', { name: 'Choose an action', exact: true }).isDisabled(),
    true,
  );
  assert.match(
    await restoredPanel
      .getByRole('button', { name: 'Select repositories', exact: true })
      .innerText(),
    /core[\s\S]*framework[\s\S]*\+1/,
  );
  await reopened.screenshot({ path: 'test-results/repositories-restored.png' });
  await reopened.keyboard.press('Escape');
  await writeFile(join(created.path, 'apps/core/main.py'), 'print("next task")\n');
  await reopened.getByRole('button', { name: 'Commit, push & PR', exact: true }).waitFor();
  await reopened.locator('.repository-operation').click();
  await reopened.getByLabel('Base branch', { exact: true }).waitFor();
  await reopened.locator('input[aria-label="Base branch"][value="main"]').waitFor();
  assert.equal(await reopened.getByLabel('Base branch', { exact: true }).inputValue(), 'main');
  assert.match(
    await reopened.getByLabel('Compare branch', { exact: true }).innerText(),
    /task\/tree/,
  );
  assert.equal(await reopened.getByLabel('PR title', { exact: true }).count(), 0);
  assert.equal(await reopened.getByLabel('Description', { exact: true }).count(), 0);
  await reopened.screenshot({ path: 'test-results/repositories-publish.png' });
  await reopened.keyboard.press('Escape');
  await writeFile(join(created.path, 'apps/framework/main.py'), 'print("next framework task")\n');
  await git(join(created.path, 'apps/framework'), ['branch', 'stage', 'main']);
  await git(join(created.path, 'apps/framework'), [
    'config',
    'branch.task/tree.gh-merge-base',
    'stage',
  ]);
  await reopened.locator('.repository-operation').click();
  await reopened.locator('.repository-comparison[title*="stage ← task/tree"]').waitFor();
  assert.equal(await reopened.getByLabel('Base branch', { exact: true }).inputValue(), '');
  assert.equal(
    await reopened.getByLabel('Base branch', { exact: true }).getAttribute('placeholder'),
    'Per repository',
  );
  assert.match(
    await reopened.getByLabel('Compare branch', { exact: true }).innerText(),
    /task\/tree/,
  );
  await reopened.screenshot({ path: 'test-results/repositories-publish-mixed.png' });
  await reopened.keyboard.press('Escape');
  await app.close();
  app = await electron.launch({
    executablePath,
    args: [...args, '--project=' + monorepo],
    env: environment,
  });
  const mono = await app.firstWindow();
  mono.on('pageerror', (error) => errors.push(error.message));
  const monoProject = (
    await mono.evaluate(() => window.superfluid.call('bootstrap', {}))
  ).projects.find((p) => p.name === basename(monorepo))!;
  const monoSession = (
    await mono.evaluate(
      (projectId) => window.superfluid.call('session.list', { projectId }),
      monoProject.id,
    )
  )[0];
  await mono.evaluate(
    (sessionId) =>
      window.superfluid.call('session.state', { sessionId, state: { repositoryIds: [] } }),
    monoSession.id,
  );
  await mono
    .getByRole('button', { name: basename(monorepo) })
    .first()
    .click();
  await mono.getByRole('button', { name: 'Project repositories', exact: true }).click();
  const monoPanel = mono.getByRole('dialog', { name: 'Branches and repositories', exact: true });
  await monoPanel.waitFor();
  assert.equal(
    await monoPanel.getByRole('button', { name: 'Select repositories', exact: true }).count(),
    0,
  );
  await mono.screenshot({ path: 'test-results/monorepo-branches.png' });
  await monoPanel.getByRole('button', { name: 'Choose Source branch', exact: true }).click();
  await mono.getByRole('option', { name: 'stage', exact: true }).click();
  await monoPanel.getByLabel('New branch name').fill('task/mono');
  await mono.getByRole('option', { name: 'Create branch task/mono', exact: true }).click();
  await monoPanel.getByRole('button', { name: 'Create & switch · 1', exact: true }).click();
  await monoPanel.waitFor({ state: 'hidden' });
  await writeFile(join(monorepo, 'main.py'), 'print("pending task")\n');
  await mono.getByRole('button', { name: 'Commit, push & PR', exact: true }).waitFor();
  await mono.locator('.repository-operation').click();
  await mono.locator('input[aria-label="Base branch"][value="stage"]').waitFor();
  assert.equal(await mono.getByLabel('Base branch', { exact: true }).inputValue(), 'stage');
  assert.match(await mono.getByLabel('Compare branch', { exact: true }).innerText(), /task\/mono/);
  await mono.screenshot({ path: 'test-results/monorepo-publish.png' });
  await mono.getByLabel('Commit message').fill('Implement task');
  await monoPanel.screenshot({ path: 'test-results/monorepo-composer.png' });
  await mono.getByRole('button', { name: 'Choose Base branch', exact: true }).click();
  await mono.getByRole('option', { name: 'main', exact: true }).click();
  assert.equal(await mono.getByLabel('Base branch', { exact: true }).inputValue(), 'main');
  assert.match(await mono.getByLabel('Compare branch', { exact: true }).innerText(), /task\/mono/);
  await mono.getByRole('button', { name: 'Choose Base branch', exact: true }).click();
  await mono.getByRole('option', { name: 'task/mono', exact: true }).click();
  await monoPanel.screenshot({ path: 'test-results/monorepo-commit-invalid-base.png' });
  await mono.keyboard.press('Escape');
  await mono.locator('.repository-operation > svg[data-provider="github"]').waitFor();
  await mono.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  await mono.getByRole('menu').waitFor();
  await mono.screenshot({ path: 'test-results/git-actions-github.png' });
  await mono.keyboard.press('Escape');
  await git(monorepo, ['remote', 'set-url', 'origin', 'git@gitlab.company.test:team/fixture.git']);
  await mono.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await mono.locator('.repository-operation > svg[data-provider="gitlab"]').waitFor();
  await mono.keyboard.press('Escape');
  await mono.getByRole('button', { name: 'Individual Git actions', exact: true }).click();
  await mono.getByRole('menu').waitFor();
  await mono.screenshot({ path: 'test-results/git-actions-gitlab.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Multi-repository Electron flow passed: selection, create, checkout, independent worktree, source buffer/process, reopen.',
  );
} finally {
  const page = await app.firstWindow().catch(() => undefined);
  await page?.screenshot({ path: 'test-results/repositories-final.png' }).catch(() => {});
  await app.close();
}
