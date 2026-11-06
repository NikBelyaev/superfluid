import { monaco } from '~/state/editor/Documents';

monaco.editor.defineTheme('darcula-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '808080', fontStyle: 'italic' },
    { token: 'keyword', foreground: '000080', fontStyle: 'bold' },
    { token: 'string', foreground: '008000' },
    { token: 'number', foreground: '0000FF' },
  ],
  colors: {},
});

monaco.editor.defineTheme('darcula-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '808080', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'CC7832' },
    { token: 'string', foreground: '6A8759' },
    { token: 'number', foreground: '6897BB' },
    { token: 'type.identifier', foreground: 'A9B7C6' },
  ],
  colors: {},
});
