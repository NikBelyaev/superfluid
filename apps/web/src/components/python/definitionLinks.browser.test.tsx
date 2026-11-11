import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

test('definition click uses the mouse symbol without first focusing its caret', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import * as monaco from 'monaco-editor/editor/editor.api';
        import 'monaco-editor/editor/browser/coreCommands';
        import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
        import { installDefinitionLinks } from './apps/web/src/components/python/definitionLinks';
        import { documents } from '~/state/editor/Documents';
        monaco.languages.register({ id: 'python' });
        const root = document.getElementById('editor');
        const model = monaco.editor.createModel('unrelated = 1\\n\\nanswer = target()\\n', 'python');
        const editor = monaco.editor.create(root, { model, automaticLayout: true });
        documents.model = model;
        installDefinitionLinks(editor);
        window.fixture = { editor, model };
        window.opened = [];
        window.requests = [];
      `,
    },
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.ttf': 'dataurl' },
    plugins: [
      {
        name: 'isolated-language-bridge',
        setup(builder) {
          builder.onResolve({ filter: /^(~\/|\.\/definitionPreview$)/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === '~/state/editor/Documents'
                ? `
            import * as monaco from 'monaco-editor/editor/editor.api';
            export { monaco };
            export const documents = {
              model: null,
              focused: { session: { id: 'other-worktree' } },
              find(model) { return model === this.model ? { model, session: { id: 'clicked-worktree' }, version: 7 } : null; },
              sync: async () => {},
              diskUri: () => 'file:///clicked-worktree/main.py',
            };
          `
                : path === '~/rpc/python'
                  ? `
            export async function callPython(method, input) {
              window.requests.push(input);
              return { uri: 'file:///clicked-worktree/definition.py', range: { start: { line: 4, character: 0 } } };
            }
          `
                  : path === './definitionPreview'
                    ? `
            export async function openDefinition(...args) { window.opened.push(args); }
          `
                    : path === '~/state/python'
                      ? `
            export const onPythonReset = () => () => {};
            export const pythonGeneration = () => 1;
          `
                      : `export const useApp = { getState: () => ({ fail: error => { throw error; } }) };`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const server = createServer((req, res) => {
    const file = bundle.outputFiles.find((file) =>
      file.path.endsWith(req.url === '/fixture.css' ? '.css' : '.js'),
    );
    res.setHeader(
      'Content-Type',
      req.url === '/' ? 'text/html' : req.url?.endsWith('.css') ? 'text/css' : 'text/javascript',
    );
    res.end(
      req.url === '/'
        ? '<link rel="stylesheet" href="/fixture.css"><input id="outside"><div id="editor" style="width:800px;height:400px"></div><script src="/fixture.js"></script>'
        : file?.contents,
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`);
      await expect(page.locator('.view-lines')).toContainText('target');
      const point = await page.evaluate(`(() => {
      const p = fixture.editor.getScrolledVisiblePosition({ lineNumber: 3, column: 12 });
      const box = document.getElementById('editor').getBoundingClientRect();
      return { x: box.x + p.left, y: box.y + p.top + p.height / 2 };
    })()`);
      for (const [modifier, outside] of [
        ['Meta', true],
        ['Meta', false],
        ['Control', true],
      ] as const) {
        await page.evaluate('fixture.editor.setPosition({ lineNumber: 1, column: 1 })');
        if (outside) await page.locator('#outside').focus();
        else await page.evaluate('fixture.editor.focus()');
        const before = await page.evaluate('window.opened.length');
        await page.keyboard.down(modifier);
        await page.mouse.click(point.x, point.y);
        await page.keyboard.up(modifier);
        await expect.poll(() => page.evaluate('window.opened.length')).toBe(before + 1);
        const request = await page.evaluate('window.requests.at(-1)');
        assert.equal(request.sessionId, 'clicked-worktree');
        assert.equal(request.params.textDocument.uri, 'file:///clicked-worktree/main.py');
        assert.deepEqual(request.params.position, { line: 2, character: 11 });
        const opened = await page.evaluate('window.opened.at(-1)');
        assert.deepEqual(opened.slice(1, 3), [7, { line: 2, character: 11 }]);
        assert.equal(opened[3].uri, 'file:///clicked-worktree/definition.py');
      }
      const before = await page.evaluate('window.opened.length');
      await page.mouse.click(point.x, point.y);
      assert.deepEqual(await page.evaluate('fixture.editor.getPosition()'), {
        lineNumber: 3,
        column: 12,
      });
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 25, point.y);
      await page.mouse.up();
      assert.equal(await page.evaluate('fixture.editor.getSelection().isEmpty()'), false);
      // A modified drag must select text, including within the same symbol.
      await page.keyboard.down('Meta');
      await page.mouse.move(point.x - 10, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 5, point.y);
      await page.mouse.up();
      await page.keyboard.up('Meta');
      assert.equal(await page.evaluate('fixture.editor.getSelection().isEmpty()'), false);
      assert.equal(await page.evaluate('window.opened.length'), before);
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
