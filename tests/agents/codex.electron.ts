import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'playwright/test';
import type { Agent } from '@superfluid/contracts';
import { createElectronFixture } from '../electronFixture';
import { createCodexFixture, codexThreadId as threadId } from './codexFixture';

const fixture = await createElectronFixture();
const codex = await createCodexFixture(join(fixture.temp, 'codex-home'), fixture.project);
let failed = false;
const response =
  '# Retry changes are ready\n\n' +
  Array.from(
    { length: 8 },
    (_, i) =>
      `## Check ${i + 1}\n\nRetries use exponential backoff and preserve the invoice idempotency key. Already-paid invoices are skipped. All regression tests pass.\n\n`,
  ).join('') +
  '**Ready for review.**';
try {
  await fixture.app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      process.env.SF_TEST_OPENED_CODEX = url;
    };
  });
  const page = await fixture.firstWindow();
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Settings: Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await expect(page.getByText('Connected through Codex hooks', { exact: true })).toBeVisible();
  const config = JSON.parse(await readFile(join(fixture.temp, 'codex-home/hooks.json'), 'utf8'));
  assert.equal(Object.keys(config.hooks).length, 8);
  await assert.rejects(
    readFile(join(fixture.temp, 'codex-home/app-server-control/app-server-control.sock')),
    { code: 'ENOENT' },
  );
  await page.screenshot({ path: 'test-results/codex-hooks-settings.png' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.codex-status-position')).toHaveCount(0);

  await codex.send('UserPromptSubmit');
  await expect(page.getByRole('button', { name: 'Codex: Working', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Message Codex', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Codex: Working', exact: true }).hover();
  await page.screenshot({ path: 'test-results/codex-hooks-working.png' });
  await page.mouse.move(0, 0);
  const read = { tool_name: 'Read', tool_use_id: 'read', tool_input: { file_path: 'main.py' } };
  await codex.send('PreToolUse', read);
  await expect(
    page.getByRole('button', { name: 'Codex: Reading files', exact: true }),
  ).toBeVisible();
  await page.getByTitle('Collapse actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Expand actions', exact: true }).click();
  await codex.send('PostToolUse', read);
  const mcp = { tool_name: 'mcp__codebase_memory_mcp__list_projects', tool_use_id: 'mcp' };
  await codex.send('PreToolUse', mcp);
  await page.getByRole('button', { name: 'Codex: List projects', exact: true }).click();
  await page.locator('.codex-steps summary').filter({ hasText: 'List projects' }).click();
  await expect(
    page.getByText('mcp__codebase_memory_mcp__list_projects', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open run', exact: true }).click();
  assert.equal(
    await fixture.app.evaluate(() => process.env.SF_TEST_OPENED_CODEX),
    'codex://threads/' + threadId,
  );
  await page.keyboard.press('Escape');
  await codex.send('PostToolUse', mcp);
  const edit = {
    tool_name: 'apply_patch',
    tool_use_id: 'edit',
    tool_input: { command: '*** Update File: main.py\n*** Update File: models.py' },
  };
  await codex.send('PreToolUse', edit);
  await expect(
    page.getByRole('button', { name: 'Codex: Editing main.py', exact: true }),
  ).toBeVisible();
  await codex.send('PostToolUse', edit);
  await codex.send('PreToolUse', {
    tool_name: 'Bash',
    tool_use_id: 'tests',
    tool_input: { command: 'python3 -m pytest tests/' },
  });
  await expect(
    page.getByRole('button', { name: 'Codex: Running tests', exact: true }),
  ).toBeVisible();
  const approved = codex.send('PermissionRequest', {
    tool_name: 'Bash',
    tool_input: { command: 'git push', description: 'Push the tested changes for review.' },
  });
  await expect(
    page.getByRole('button', { name: 'Codex: Needs approval: git push', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Codex: Needs approval: git push', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Request details' })).toContainText(
    'Push the tested changes for review.',
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  assert.equal((await approved).hookSpecificOutput.decision.behavior, 'allow');
  const denied = codex.send('PermissionRequest', {
    tool_name: 'Bash',
    tool_input: { command: 'git clean -fd' },
  });
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  assert.equal((await denied).hookSpecificOutput.decision.behavior, 'deny');
  await page.getByRole('button', { name: 'Codex: Running tests', exact: true }).click();
  await expect(page.locator('.codex-changed-files li')).toHaveText(['main.py', 'models.py']);
  await page.screenshot({ path: 'test-results/codex-hooks-files.png' });
  await page.keyboard.press('Escape');
  await codex.send('Stop', { last_assistant_message: response });
  const doneButton = () => page.getByRole('button', { name: /^Codex: Done in / });
  await doneButton().click();
  const answer = page.getByRole('region', { name: 'Agent response' });
  await expect(answer).toContainText('Retry changes are ready');
  await expect(
    answer.getByRole('heading', { name: 'Retry changes are ready', exact: true }),
  ).toBeVisible();
  await expect(answer.locator('strong')).toHaveText('Ready for review.');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.codex-history')).toHaveCount(0);
  assert.ok(await answer.evaluate((node) => node.scrollHeight > node.clientHeight));
  await page.screenshot({ path: 'test-results/agent-deck-long-response.png' });
  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await page.getByRole('textbox').fill('Draft while reading');
  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await expect(answer).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('Draft while reading');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  const message = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await expect(message).toBeFocused();
  await message.fill('fail');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to queue the fixture message');
  await expect(message).toHaveCount(0);
  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await expect(message).toHaveValue('fail');
  const text = 'Continue with "literal" $(commands)\nand a second line';
  await message.fill(text);
  await codex.holdQueue();
  try {
    await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
    await codex.queueHeld();
    await expect(message).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Codex: Queued', exact: true })).toBeFocused();
    await page.screenshot({ path: 'test-results/codex-hooks-queued.png' });
  } finally {
    await codex.releaseQueue();
  }
  await page.getByRole('button', { name: 'New worktree', exact: true }).first().click();
  await page.getByLabel('Branch name').fill('feature/codex');
  await page.getByLabel('Start from').fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.worktree-chip.active').filter({ hasText: 'feature/codex' }).waitFor();
  await expect(page.locator('.codex-status-position')).toHaveCount(0);
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await expect(page.getByRole('button', { name: 'Codex: Queued', exact: true })).toBeVisible();
  const [queued] = await codex.queueCalls();
  assert.deepEqual(queued.args, ['queue', '--thread', threadId, '--message=' + text]);
  assert.equal(queued.cwd, await realpath(fixture.project));
  assert.equal(queued.home, join(fixture.temp, 'codex-home'));
  const topics = [
    'На примере: как запрос проходит через модули',
    'Где искать код для конкретной задачи',
    'Чем entity, command, query и event отличаются друг от друга',
  ];
  await codex.send('UserPromptSubmit', { turn_id: 'question-turn' });
  await codex.send('Stop', { last_assistant_message: 'Choose the next topic.' });
  // Exercise the retained question UI through its event contract without a Codex transport.
  const showQuestion = async (question: NonNullable<Agent['question']>) => {
    const agent = (
      await page.evaluate(() => window.superfluid.call('bootstrap', {}))
    ).codexAgents.find((agent) => agent.id === threadId)!;
    const nativeWindow = await fixture.app.browserWindow(page);
    try {
      await nativeWindow.evaluate(
        (window, agent) =>
          window.webContents.send('workspace:event', { type: 'codex.agent', agent }),
        { ...agent, status: 'needs-input' as const, question },
      );
    } finally {
      await nativeWindow.dispose();
    }
  };
  await showQuestion({
    id: 'question-one',
    questions: [{ title: 'Что разобрать следующим шагом?', options: topics }],
  });
  const question = page.getByRole('button', { name: 'Codex: Needs your input', exact: true });
  await expect(question).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await question.click();
  const choices = page.getByRole('region', { name: 'Request details' });
  const architecture = choices.getByRole('radio', { name: topics[0], exact: true });
  const ownAnswer = page.getByRole('textbox', { name: 'Answer Codex', exact: true });
  const sendAnswer = page.getByRole('button', { name: 'Send to Codex', exact: true });
  await expect(sendAnswer).toBeDisabled();
  await choices.getByText(topics[0], { exact: true }).click();
  await expect(architecture).toBeChecked();
  await expect(ownAnswer).toHaveValue('');
  await expect(sendAnswer).toBeEnabled();
  await page.screenshot({ path: 'test-results/agent-deck-question.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(choices).toBeHidden();
  await page.getByRole('button', { name: 'Codex: Question deferred', exact: true }).click();
  await expect(architecture).toBeChecked();
  await architecture.focus();
  await page.keyboard.press('ArrowDown');
  await expect(choices.getByRole('radio', { name: topics[1], exact: true })).toBeChecked();
  await ownAnswer.fill('fail');
  await expect(choices.getByRole('radio', { checked: true })).toHaveCount(0);
  await sendAnswer.click();
  await expect(page.getByRole('alert')).toContainText('Unable to queue the fixture message');
  await expect(ownAnswer).toHaveCount(0);
  await question.click();
  await expect(ownAnswer).toHaveValue('fail');
  await ownAnswer.fill('Explain the request flow');
  await page.locator('.worktree-chip').filter({ hasText: 'feature/codex' }).click();
  await expect(ownAnswer).toHaveCount(0);
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await question.click();
  await expect(ownAnswer).toHaveValue('Explain the request flow');
  await ownAnswer.press('Meta+Enter');
  await expect(page.getByRole('button', { name: 'Codex: Queued', exact: true })).toBeVisible();
  await expect(ownAnswer).toHaveCount(0);
  await codex.queueRecorded('Explain the request flow');
  assert.equal(
    (await codex.queueCalls()).at(-1)?.args.at(-1),
    '--message=Explain the request flow',
  );
  await codex.send('UserPromptSubmit', { turn_id: 'multiple-questions' });
  await codex.send('Stop');
  await showQuestion({
    id: 'question-two',
    questions: [
      { title: 'What should we explore?', options: ['Architecture', 'Tests'] },
      { title: 'Any constraints?' },
    ],
  });
  await question.click();
  await expect(sendAnswer).toBeDisabled();
  await expect(choices.getByRole('radio', { checked: true })).toHaveCount(0);
  const firstAnswer = page.getByRole('textbox', {
    name: 'Answer Codex: What should we explore?',
    exact: true,
  });
  const constraints = page.getByRole('textbox', {
    name: 'Answer Codex: Any constraints?',
    exact: true,
  });
  await expect(firstAnswer).toHaveValue('');
  await expect(constraints).toHaveValue('');
  await firstAnswer.fill('a'.repeat(10000));
  await constraints.fill('b'.repeat(6000));
  await expect(sendAnswer).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('16,000');
  await choices.getByText('Tests', { exact: true }).click();
  await constraints.fill('Keep `literal` $(commands) as text');
  await expect(sendAnswer).toBeEnabled();
  await sendAnswer.click();
  await expect(choices).toBeHidden();
  const combined =
    'What should we explore?\nTests\n\nAny constraints?\nKeep `literal` $(commands) as text';
  await codex.queueRecorded(combined);
  assert.equal((await codex.queueCalls()).at(-1)?.args.at(-1), '--message=' + combined);
  await codex.send('UserPromptSubmit', { turn_id: 'next-turn' });
  await expect(page.getByRole('button', { name: 'Codex: Working', exact: true })).toBeVisible();
  await codex.send('Interrupt');
  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await expect(message).toHaveValue('');
  await message.fill('Draft for the main worktree');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dismiss Codex status', exact: true }).click();
  await page.locator('.worktree-chip').filter({ hasText: 'feature/codex' }).click();
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await expect(page.locator('.codex-status-position')).toHaveCount(0);
  await page.locator('.worktree-chip').filter({ hasText: 'feature/codex' }).click();
  await codex.send('UserPromptSubmit', { turn_id: 'inactive-turn' });
  await expect(page.locator('.codex-status-position')).toHaveCount(0);
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await expect(page.getByRole('button', { name: 'Codex: Working', exact: true })).toBeVisible();
  await codex.send('Stop');
  await page.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await expect(message).toHaveValue('Draft for the main worktree');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dismiss Codex status', exact: true }).click();
  await fixture.reopen();
  const reopened = await fixture.firstWindow();
  await reopened.clock.install();
  await reopened
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await expect(reopened.locator('.codex-status-position')).toHaveCount(0);
  await codex.send('UserPromptSubmit', { turn_id: 'timer-turn' });
  const pills = reopened.locator('.codex-status-position[data-provider="Codex"]');
  await expect(reopened.getByRole('button', { name: 'Codex: Working', exact: true })).toBeVisible();
  await reopened.clock.runFor(91000);
  const elapsed = await pills.locator('.codex-elapsed').textContent();
  assert.match(elapsed!, /^1:3\d$/);
  await codex.send('PreToolUse', read);
  await expect(
    reopened.getByRole('button', { name: 'Codex: Reading files', exact: true }),
  ).toBeVisible();
  await expect(pills.locator('.codex-elapsed')).toHaveText(elapsed!);
  const timerApproval = codex.send('PermissionRequest', {
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  });
  await expect(reopened.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await expect(pills.locator('.codex-elapsed')).toHaveText(elapsed!);
  await reopened.getByRole('button', { name: 'Deny', exact: true }).click();
  await timerApproval;
  await codex.send('Stop');
  await codex.send('UserPromptSubmit', {
    session_id: '22222222-2222-4222-8222-222222222222',
    turn_id: 'other-turn',
  });
  await expect(pills).toHaveCount(2);
  const front = reopened.locator('[data-agent-card][data-front]');
  await expect(front).toHaveAttribute('data-agent-card', 'codex:' + threadId);
  await reopened.mouse.move(0, 0);
  await expect(reopened.getByRole('button', { name: 'Codex: Working', exact: true })).toBeHidden();
  await reopened.getByRole('button', { name: 'Show agents', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Codex: Working', exact: true })).toBeVisible();
  await expect(
    reopened.getByRole('button', { name: 'Codex: Working', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await reopened.screenshot({
    path: 'test-results/agent-deck-expanded.png',
    animations: 'disabled',
  });
  await reopened.getByRole('button', { name: 'Codex: Working', exact: true }).click();
  await expect(front).toHaveAttribute(
    'data-agent-card',
    'codex:22222222-2222-4222-8222-222222222222',
  );
  await reopened.getByRole('button', { name: 'Codex: Working', exact: true }).click();
  await expect(front.locator('.codex-history')).toBeVisible();
  await reopened.keyboard.press('Escape');
  await codex.send('UserPromptSubmit', {
    session_id: '33333333-3333-4333-8333-333333333333',
    turn_id: 'third-turn',
  });
  await codex.send('Stop', {
    session_id: '33333333-3333-4333-8333-333333333333',
    last_assistant_message: 'Third task is ready.',
  });
  await expect(pills).toHaveCount(3);
  await expect(reopened.getByRole('combobox', { name: 'Codex session', exact: true })).toHaveCount(
    0,
  );
  await reopened.screenshot({ path: 'test-results/codex-hooks-sessions.png' });
  const mobile = await reopened.context().newCDPSession(reopened);
  await mobile.send('Emulation.setDeviceMetricsOverride', {
    width: 768,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await mobile.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  assert.equal(
    await reopened.evaluate(() => matchMedia('(hover:hover) and (pointer:fine)').matches),
    false,
  );
  await expect(reopened.getByRole('button', { name: 'Codex: Working', exact: true })).toBeHidden();
  await reopened.screenshot({
    path: 'test-results/agent-deck-touch-collapsed.png',
    animations: 'disabled',
  });
  await reopened.getByRole('button', { name: 'Show agents', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Codex: Working', exact: true })).toBeVisible();
  await reopened.screenshot({
    path: 'test-results/agent-deck-touch-expanded.png',
    animations: 'disabled',
  });
  await reopened.getByRole('button', { name: 'Show agents', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Codex: Working', exact: true })).toBeHidden();
  await mobile.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await mobile.send('Emulation.clearDeviceMetricsOverride');
  await mobile.detach();
  await front.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await reopened.getByRole('textbox').fill('Queue this task and show the next result');
  await reopened.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(front).toHaveAttribute(
    'data-agent-card',
    'codex:33333333-3333-4333-8333-333333333333',
  );
  await expect(reopened.getByRole('textbox')).toHaveCount(0);
  await codex.send('UserPromptSubmit', { turn_id: 'timer-again' });
  await codex.send('Stop', { last_assistant_message: 'The first task completed again.' });
  await front.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await reopened.getByRole('textbox').fill('Draft belongs to the first agent');
  await front.getByRole('button', { name: 'Dismiss Codex status', exact: true }).click();
  await expect(pills).toHaveCount(2);
  await expect(reopened.getByRole('textbox')).toHaveCount(0);
  await expect(front.locator('[data-status="done"]')).toBeVisible();
  await front.getByRole('button', { name: 'Message Codex', exact: true }).click();
  await reopened.getByRole('textbox').fill('Draft belongs to the next agent');
  await front.getByRole('button', { name: 'Dismiss Codex status', exact: true }).click();
  await expect(pills).toHaveCount(1);
  await expect(reopened.getByRole('textbox')).toHaveCount(0);
  await expect(front.locator('[data-status="working"]')).toBeVisible();
  const firstRequest = codex.send('PermissionRequest', {
    session_id: '22222222-2222-4222-8222-222222222222',
    turn_id: 'other-turn',
    tool_name: 'Bash',
    tool_input: { command: 'git push' },
  });
  await expect(
    front.getByRole('button', { name: 'Codex: Needs approval: git push', exact: true }),
  ).toBeVisible();
  await codex.send('UserPromptSubmit', {
    session_id: '44444444-4444-4444-8444-444444444444',
    turn_id: 'fourth-turn',
  });
  const nextRequest = codex.send('PermissionRequest', {
    session_id: '44444444-4444-4444-8444-444444444444',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm install' },
  });
  await expect(pills).toHaveCount(2);
  await expect(front.locator('.codex-approval-actions')).toContainText('1/2');
  await reopened.locator('.agent-deck').hover();
  await expect(
    reopened.getByRole('button', { name: 'Codex: Needs approval: pnpm install', exact: true }),
  ).toBeHidden();
  await front.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(
    front.getByRole('button', { name: 'Codex: Needs approval: pnpm install', exact: true }),
  ).toBeVisible();
  await front.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(
    front.getByRole('button', { name: 'Codex: Approval deferred', exact: true }),
  ).toBeVisible();
  await front.locator('[data-agent-trigger]').click();
  await expect(front.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await reopened.screenshot({
    path: 'test-results/agent-deck-request-details.png',
    animations: 'disabled',
  });
  await front.getByRole('button', { name: 'Deny', exact: true }).click();
  assert.equal((await firstRequest).hookSpecificOutput.decision.behavior, 'deny');
  await reopened.getByRole('button', { name: 'Show agents', exact: true }).click();
  await reopened.getByRole('button', { name: 'Codex: Approval deferred', exact: true }).click();
  await front.getByRole('button', { name: 'Approve', exact: true }).click();
  assert.equal((await nextRequest).hookSpecificOutput.decision.behavior, 'allow');
  await reopened.keyboard.press('Meta+Shift+P');
  await reopened.getByRole('button', { name: 'Settings: Agents', exact: true }).click();
  await reopened.getByRole('button', { name: 'Disconnect Codex', exact: true }).click();
  await expect(
    reopened
      .getByRole('region', { name: 'Codex', exact: true })
      .getByText('Not connected', { exact: true }),
  ).toBeVisible();
  await reopened.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(pills).toHaveCount(0);
  assert.deepEqual(fixture.errors, []);
  console.log(
    'Electron Codex hooks passed: installed helper, files, approvals, CLI queue, timer, worktrees and restart.',
  );
} catch (error) {
  failed = true;
  await fixture.captureFailure();
  throw error;
} finally {
  await codex.releaseQueue();
  await fixture.dispose(failed);
}
