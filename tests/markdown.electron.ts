import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'playwright/test';
import { createElectronFixture } from './electronFixture';

const fixture = await createElectronFixture();
let failed = false;
try {
  await mkdir(join(fixture.project, 'docs'));
  await writeFile(
    join(fixture.project, 'docs/guide.MARKDOWN'),
    '# Local guide\n\n```mermaid\nflowchart LR\n  Guide --> Preview\n```\n',
  );
  let page = await fixture.firstWindow();
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('[data-path="README.md"]').click();
  const main = page.getByRole('region', { name: 'Main surface', exact: true });
  await expect(main.locator('.view-lines')).toContainText('Pending documentation changes.');
  await main.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    '# Markdown preview\n\n**Current buffer**\n\n' +
      '- [x] Render tasks\n- [ ] Keep editing\n\n' +
      '| Feature | State |\n| --- | --- |\n| Tables | Ready |\n\n' +
      '| File path | Description | Worktree | Repository | Status |\n| --- | --- | --- | --- | --- |\n' +
      '| src/components/workspace/VeryLongMarkdownPreviewComponent.tsx | A readable description that should keep its natural width instead of squeezing into a narrow column | feature/markdown-preview | superfluid/workspace | Ready for review |\n\n' +
      '> A quote\n\n```python\nprint("hello")\n```\n\n' +
      '```mermaid\nflowchart TB\naccTitle: Editing flow\n' +
      'Source["Мобильные объекты (техника)"] -.->|"Передаёт телеметрию (TCP)"| Receiver["VGApp-коммуникатор"]\n' +
      'Dispatcher["Диспетчер"] -.->|"Работает с интерфейсом"| App\n' +
      'subgraph Server["VIST FMS — серверная часть базового продукта"]\n' +
      'App["Django-приложение: UI, REST, GraphQL, admin"] --> Preview["Основная БД"]\n' +
      'Huey["Исполнитель задач Huey (run_huey)"] -.->|"Очередь и расписание задач"| Redis["Redis: очереди, кеши, состояние"]\n' +
      'App -.-> Redis\nend\nReceiver -.-> Redis\nSource --> Preview\nclick Receiver "javascript:alert(1)"\n```\n\n' +
      '```mermaid\nsequenceDiagram\naccTitle: Save sequence\nparticipant R as VgappReceiver (async)\nparticipant Q as Очередь Redis (db1)\nparticipant A as Archive\nR->>Q: distribute_messages (сбой отправки — лог; затем возможен ack)\nQ-->>A: пачка сообщений\nA->>A: CreateEventArchive (MessageArchive?; skip_save_message; StaticEventArchive)\n```\n\n' +
      '```mermaid\nflowchart LR\nA --> [\n```\n\n' +
      '[Local guide](docs/guide.MARKDOWN)\n\n' +
      '[Unsafe](javascript:alert(1))\n\n<script>throw new Error("unsafe markdown")</script>\n',
  );
  await page.screenshot({ path: 'test-results/markdown-source.png' });
  await main.getByRole('button', { name: 'Toggle Markdown preview', exact: true }).click();
  const preview = main.getByRole('article', { name: 'Markdown preview', exact: true });
  await page.screenshot({ path: 'test-results/markdown-table.png' });
  await expect(
    preview.getByRole('heading', { name: 'Markdown preview', exact: true }),
  ).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('Current buffer');
  await expect(preview.getByRole('cell', { name: 'Ready', exact: true })).toBeVisible();
  await expect(preview.getByRole('checkbox').first()).toBeChecked();
  await expect(preview.locator('pre code.language-python')).toHaveText('print("hello")\n');
  const flow = preview.getByRole('img', { name: 'Editing flow', exact: true });
  await expect(flow).toBeVisible();
  const flowBlock = preview.locator('.mermaid-diagram').first();
  await flowBlock.getByRole('button', { name: 'Toggle Mermaid source', exact: true }).click();
  const diagramSource = flowBlock.getByLabel('Mermaid source', { exact: true });
  await expect(diagramSource).toContainText('Source --> Preview');
  await flowBlock.getByRole('button', { name: 'Copy Mermaid source', exact: true }).click();
  await expect(flowBlock.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  assert.equal(
    await fixture.app.evaluate(({ clipboard }) => clipboard.readText()),
    await diagramSource.textContent(),
  );
  await expect(flow).toHaveCount(0);
  await flowBlock.getByRole('button', { name: 'Toggle Mermaid source', exact: true }).click();
  await expect(flow).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Save sequence', exact: true })).toBeVisible();
  const sequenceBlock = preview.locator('.mermaid-diagram').nth(1);
  await sequenceBlock.getByRole('button', { name: 'Toggle Mermaid source', exact: true }).click();
  await expect(sequenceBlock.getByLabel('Mermaid source', { exact: true })).toContainText(
    'лог; затем возможен ack',
  );
  await sequenceBlock.getByRole('button', { name: 'Toggle Mermaid source', exact: true }).click();
  await expect(
    preview.getByRole('status').filter({ hasText: 'Unable to render Mermaid diagram' }),
  ).toBeVisible();
  await expect(preview.locator('script')).toHaveCount(0);
  await expect(preview.locator('svg a, svg image, svg foreignObject')).toHaveCount(0);
  await expect(preview.getByText('Unsafe', { exact: true })).toHaveAttribute('href', '');
  await expect(main.locator('.editor-host')).toBeHidden();
  await page.screenshot({ path: 'test-results/markdown-preview.png' });

  await page.locator('[data-path="main.py"]').click();
  await expect(main.locator('.view-lines')).toContainText('store = Store()');
  await page.locator('[data-path="README.md"]').click();
  await expect(preview.locator('strong')).toHaveText('Current buffer');

  const lightDiagram = await flow.evaluate((element) => getComputedStyle(element).color);
  await page.keyboard.press('Meta+,');
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Dark', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(flow).not.toHaveCSS('color', lightDiagram);
  await flowBlock.screenshot({ path: 'test-results/markdown-flowchart-dark.png' });
  await page.screenshot({ path: 'test-results/markdown-diagrams-dark.png' });
  await page.keyboard.press('Meta+,');
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Light', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();

  await main.getByRole('button', { name: 'Toggle Markdown preview', exact: true }).click();
  await expect(main.locator('.editor-host')).toBeVisible();
  await expect(main.getByRole('textbox', { name: 'Editor content', exact: true })).toBeFocused();
  await page.keyboard.press('Meta+ArrowUp');
  await expect(main.locator('.view-lines')).toContainText('Current buffer');
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText('\n**Edited again**\n');
  await main.getByRole('button', { name: 'Toggle Markdown preview', exact: true }).click();
  await expect(preview.getByText('Edited again', { exact: true })).toBeVisible();
  await preview.getByRole('link', { name: 'Local guide', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Local guide', exact: true })).toBeVisible();
  const guide = main.getByRole('tab', { name: 'guide.MARKDOWN', exact: true });
  await guide.hover();
  const from = (await guide.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 2 });
  await expect(page.locator('.tab-drag-preview')).toBeVisible();
  const right = page.getByRole('region', { name: 'Secondary surfaces', exact: true });
  const to = (await right.locator('.surface-panel').boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(right).toHaveAttribute('data-drop-target', 'true');
  await page.mouse.up();
  await expect(page.locator('.tab-drag-preview')).toHaveCount(0);
  await expect(right.getByRole('heading', { name: 'Local guide', exact: true })).toBeVisible();
  await expect(right.getByRole('img', { name: 'Mermaid diagram', exact: true })).toBeVisible();
  await right.getByRole('button', { name: 'Toggle Markdown preview', exact: true }).click();
  await expect(right.locator('.editor-host')).toBeVisible();
  await right.getByRole('button', { name: 'Toggle Markdown preview', exact: true }).click();
  await main.getByRole('tab', { name: 'README.md', exact: true }).click();
  await expect(preview.locator('strong')).toHaveText(['Current buffer', 'Edited again']);

  await page.getByRole('button', { name: 'New worktree', exact: true }).first().click();
  await page.getByLabel('Branch name').fill('feature/markdown');
  await page.getByLabel('Start from').fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.worktree-chip.active').filter({ hasText: 'feature/markdown' }).waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('[data-path="README.md"]').click();
  await expect(
    main.getByRole('button', { name: 'Toggle Markdown preview', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(main.locator('.view-lines')).toContainText('A real Python fixture');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await expect(preview.locator('strong')).toHaveText(['Current buffer', 'Edited again']);

  await fixture.reopen();
  page = await fixture.firstWindow();
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await expect(
    page.getByRole('article', { name: 'Markdown preview', exact: true }).locator('strong'),
  ).toHaveText(['Current buffer', 'Edited again']);
  await writeFile(join(fixture.project, 'README.md'), '# Refreshed preview\n');
  const restored = page.getByRole('region', { name: 'Main surface', exact: true });
  await expect(
    restored.getByRole('heading', { name: 'Refreshed preview', exact: true }),
  ).toBeVisible();
  await expect(restored.getByRole('img')).toHaveCount(0);
  await restored.getByRole('button', { name: 'Toggle Markdown preview', exact: true }).click();
  await expect(restored.locator('.editor-host')).toBeVisible();
  assert.deepEqual(fixture.errors, []);
  console.log(
    'Markdown preview passed: diagrams, themes, errors, buffer, controls, links, worktrees and restart.',
  );
} catch (error) {
  failed = true;
  await fixture.captureFailure();
  throw error;
} finally {
  await fixture.dispose(failed);
}
