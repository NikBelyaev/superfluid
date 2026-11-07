/// <reference types="vite/client" />

declare module 'monaco-editor/languages/definitions/python/python' {
  export const conf: import('monaco-editor/editor/editor.api').languages.LanguageConfiguration;
  export const language: import('monaco-editor/editor/editor.api').languages.IMonarchLanguage;
}
