import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownOptions } from './markdownOptions';

test('YAML front matter is highlighted code with its contents preserved and escaped', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      ...markdownOptions,
      children:
        '\ufeff---\r\ntitle: "Компонент"\r\ntags: [system_design, c4]\r\n' +
        'description: |\r\n  <script>alert(1)</script>\r\n---\r\n\r\n' +
        '# Document\r\n\r\nUse `Person`.\r\n\r\n---\r\n',
    }),
  );
  assert.match(html, /^<pre><code class="hljs language-yaml">/);
  assert.match(html, /<span class="hljs-attr">title:<\/span>/);
  assert.match(html, /Компонент/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<h1>Document<\/h1>/);
  assert.match(html, /<p>Use <code>Person<\/code>\.<\/p>/);
  assert.equal(html.match(/<hr\/>/g)?.length, 1);
});

test('ordinary separators, incomplete front matter and fenced examples keep Markdown semantics', () => {
  for (const children of [
    'Paragraph\n\n---\n\ntitle: Body\n---\n',
    '---\ntitle: Unfinished\n',
    '```text\n---\ntitle: Example\n---\n```\n',
    '```mermaid\nflowchart LR\nA --> B\n```\n',
  ]) {
    assert.equal(
      renderToStaticMarkup(createElement(Markdown, { ...markdownOptions, children })),
      renderToStaticMarkup(
        createElement(Markdown, { ...markdownOptions, remarkPlugins: [remarkGfm], children }),
      ),
    );
  }
});
