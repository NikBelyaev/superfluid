import { monaco } from '~/state/editor/Documents';

monaco.editor.defineTheme('superfluid-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '71717A' },
    { token: 'keyword', foreground: '8056A4' },
    { token: 'string', foreground: '397857' },
    { token: 'number', foreground: 'B15F29' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#18181B',
    'editorLineNumber.foreground': '#71717A',
    'editorLineNumber.activeForeground': '#27272A',
    'editor.lineHighlightBackground': '#FAFAFA',
    'editor.selectionBackground': '#DDE9FF',
    'editorCursor.foreground': '#245FDB',
    'editorIndentGuide.background1': '#F4F4F5',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#E4E4E7',
  },
});
