import type { languages } from 'monaco-editor/editor/editor.api';
import { language } from 'monaco-editor/languages/definitions/python/python';

// Monaco's f-string rules end at a single quote or line boundary, even after triple quotes.
export const pythonTokens: languages.IMonarchLanguage = {
  ...language,
  tokenizer: {
    ...language.tokenizer,
    root: [
      [/(?:[fF][rR]?|[rR][fF])("""|''')/, 'string', '@multilineFString.$1'],
      ...language.tokenizer.root,
    ],
    multilineFString: [
      [/$S2/, 'string', '@pop'],
      [/\{\{|\}\}/, 'string'],
      [/\{/, 'delimiter.curly', '@multilineFExpression'],
      [/\\./, 'string.escape'],
      [/[^\\{}'"]+/, 'string'],
      [/./, 'string'],
    ],
    multilineFExpression: [
      [/\}/, 'delimiter.curly', '@pop'],
      [/:/, { token: 'string', switchTo: '@multilineFFormat' }],
      { include: '@expressionContent' },
    ],
    multilineFFormat: [
      [/\}/, 'delimiter.curly', '@pop'],
      [/\{/, 'delimiter.curly', '@multilineFExpression'],
      [/[^{}]+/, 'string'],
    ],
    nestedExpression: [[/[}\])]/, '@brackets', '@pop'], { include: '@expressionContent' }],
    expressionContent: [
      [/[{\[(]/, '@brackets', '@nestedExpression'],
      [/(?:[fF][rR]?|[rR][fF])("""|'''|"|')/, 'string', '@multilineFString.$1'],
      [/(?:[rRuUbB]|[rR][bB]|[bB][rR])?("""|'''|"|')/, 'string', '@expressionString.$1'],
      [/#.*$/, 'comment'],
      { include: '@root' },
    ],
    expressionString: [
      [/$S2/, 'string', '@pop'],
      [/\\./, 'string.escape'],
      [/[^\\'"]+/, 'string'],
      [/./, 'string'],
    ],
  },
};
