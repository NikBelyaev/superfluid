import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { createElectronFixture } from '../electronFixture';
import { createT3Fixture, t3Thread, t3Step } from './t3Fixture';

const fixture = await createElectronFixture();
const t3 = await createT3Fixture(fixture.project);
let failed = false;
try {
  await fixture.app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      process.env.SF_TEST_OPENED_T3 = url;
    };
  });
  const page = await fixture.firstWindow();
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  await page.screenshot({ path: 'test-results/t3-before.png' });
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Settings: Agents', exact: true }).click();
  await page.getByLabel('T3 pairing link', { exact: true }).fill(t3.pairingLink);
  await page.getByRole('button', { name: 'Connect T3', exact: true }).click();
  const settings = page.getByRole('region', { name: 'T3 Code', exact: true });
  await expect(settings.getByText('Receiving activity', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/t3-settings.png' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'T3: Working', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Message T3', exact: true })).toHaveCount(0);
  await t3.event('thread-one', 'turn-item.updated', t3Step());
  await expect(page.getByRole('button', { name: 'T3: Running tests', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'T3: Running tests', exact: true }).click();
  await page.locator('.codex-steps summary').filter({ hasText: 'Running tests' }).click();
  await expect(page.getByText('python3 -m pytest tests/', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/t3-steps.png' });
  await page.getByRole('button', { name: 'Open run', exact: true }).click();
  assert.equal(
    await fixture.app.evaluate(() => process.env.SF_TEST_OPENED_T3),
    't3code://threads/fixture-environment/thread-one',
  );
  await page.keyboard.press('Escape');
  await t3.event(
    'thread-one',
    'turn-item.updated',
    t3Step({
      id: 'answer',
      type: 'assistant_message',
      text: '## Tests are ready\n\nAll **12 tests** pass.',
    }),
  );
  await t3.shell(t3Thread(fixture.project, { status: 'completed', activeRunId: null }));
  await page.getByRole('button', { name: /^T3: Done in / }).click();
  await expect(page.getByRole('region', { name: 'Agent response' })).toContainText(
    'All 12 tests pass.',
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Message T3', exact: true }).click();
  const message = page.getByRole('textbox', { name: 'Message T3', exact: true });
  await expect(message).toBeFocused();
  await message.fill('Continue with `literal` $(commands)\nand quotes "here"');
  t3.rejectCommand();
  await page.getByRole('button', { name: 'Send to T3', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('T3 rejected the command');
  await expect(message).toHaveCount(0);
  await page.getByRole('button', { name: 'Message T3', exact: true }).click();
  await expect(message).not.toHaveValue('');
  await page.getByRole('button', { name: 'Send to T3', exact: true }).click();
  await expect(page.getByRole('button', { name: 'T3: Queued', exact: true })).toBeVisible();
  assert.equal(t3.commands.at(-1)?.text, 'Continue with `literal` $(commands)\nand quotes "here"');
  await expect(message).toHaveCount(0);
  await page.screenshot({ path: 'test-results/t3-message.png' });
  await t3.shell(t3Thread(fixture.project));
  await expect(page.getByRole('button', { name: 'T3: Working', exact: true })).toBeVisible();
  const request = {
    id: 'request-one',
    kind: 'command',
    status: 'pending',
    responseCapability: { type: 'live' },
    createdAt: new Date().toISOString(),
  };
  await t3.event('thread-one', 'runtime-request.updated', request);
  await t3.event(
    'thread-one',
    'turn-item.updated',
    t3Step({
      type: 'approval_request',
      requestId: request.id,
      prompt: 'Allow git push?',
      options: [{ decision: 'accept' }, { decision: 'decline' }],
    }),
  );
  await expect(
    page.getByRole('button', { name: 'T3: Allow git push?', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/t3-approval.png' });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  assert.equal(t3.commands.at(-1)?.decision, 'accept');
  await t3.event('thread-one', 'runtime-request.updated', { ...request, status: 'resolved' });
  await t3.event('thread-one', 'runtime-request.updated', { ...request, id: 'request-two' });
  await t3.event(
    'thread-one',
    'turn-item.updated',
    t3Step({
      id: 'approval-two',
      type: 'approval_request',
      requestId: 'request-two',
      prompt: 'Allow git push again?',
      options: [{ decision: 'accept' }, { decision: 'decline' }],
    }),
  );
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deny', exact: true })).toHaveCount(0);
  assert.equal(t3.commands.at(-1)?.decision, 'decline');
  await t3.event('thread-one', 'runtime-request.updated', { ...request, status: 'resolved' });
  await t3.event('thread-one', 'runtime-request.updated', {
    ...request,
    id: 'request-two',
    status: 'resolved',
  });
  await page.getByRole('button', { name: 'New worktree', exact: true }).first().click();
  await page.getByLabel('Branch name').fill('feature/t3');
  await page.getByLabel('Start from').fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.worktree-chip.active').filter({ hasText: 'feature/t3' }).waitFor();
  await expect(page.getByRole('button', { name: /^T3:/ })).toHaveCount(0);
  await t3.shell(t3Thread(fixture.project, { status: 'completed', activeRunId: null }));
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await expect(page.getByRole('button', { name: /^T3: Done in / })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss T3 status', exact: true }).click();
  await expect(page.getByRole('button', { name: /^T3:/ })).toHaveCount(0);
  await fixture.reopen();
  const reopened = await fixture.firstWindow();
  await reopened
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await expect(reopened.getByRole('button', { name: /^T3: Done in / })).toBeVisible();
  await reopened.keyboard.press('Meta+Shift+P');
  await reopened.getByRole('button', { name: 'Settings: Agents', exact: true }).click();
  await reopened.getByRole('button', { name: 'Disconnect T3', exact: true }).click();
  await expect(
    reopened
      .getByRole('region', { name: 'T3 Code', exact: true })
      .getByText('Not connected', { exact: true }),
  ).toBeVisible();
  assert.deepEqual(fixture.errors, []);
  console.log(
    'Electron T3 passed: pairing, steps, messages, approvals, worktree isolation and reconnect.',
  );
} catch (error) {
  failed = true;
  await fixture.captureFailure();
  throw error;
} finally {
  await fixture.dispose(failed);
  await t3.close();
}
