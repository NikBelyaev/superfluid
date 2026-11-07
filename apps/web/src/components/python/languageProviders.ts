import { callPython } from '~/rpc/python';
import { documents, monaco } from '~/state/editor/Documents';
import { definitionLink, definitionTrust } from './definitionPreview';

async function request(
  model: monaco.editor.ITextModel,
  method: any,
  token: monaco.CancellationToken,
  position?: monaco.Position,
  extra: Record<string, unknown> = {},
) {
  const doc = documents.find(model);
  if (!doc || doc.readOnly || token.isCancellationRequested) return null;
  await documents.sync(doc);
  return callPython(
    'lsp.request',
    {
      sessionId: doc.session.id,
      method,
      params: {
        textDocument: { uri: documents.diskUri(doc) },
        ...(position
          ? { position: { line: position.lineNumber - 1, character: position.column - 1 } }
          : {}),
        ...extra,
      },
    },
    token,
  );
}

const range = (r: any) =>
  new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);

monaco.languages.registerCompletionItemProvider('python', {
  triggerCharacters: ['.'],
  provideCompletionItems: async (model, position, _context, token) => {
    try {
      const result = await request(model, 'textDocument/completion', token, position);
      if (token.isCancellationRequested) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      return {
        suggestions: (result?.items ?? result ?? []).slice(0, 300).map((i: any) => ({
          label: i.label,
          kind: monaco.languages.CompletionItemKind.Text,
          detail: i.detail,
          documentation: i.documentation,
          insertText: i.textEdit?.newText ?? i.insertText ?? i.label,
          insertTextRules:
            i.insertTextFormat === 2
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : 0,
          range: i.textEdit?.range
            ? range(i.textEdit.range)
            : new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              ),
          sortText: i.sortText,
          filterText: i.filterText,
        })),
      };
    } catch {
      return { suggestions: [] };
    }
  },
});

monaco.languages.registerHoverProvider('python', {
  provideHover: async (model, position, token) => {
    try {
      const doc = documents.find(model);
      if (!doc || doc.readOnly || token.isCancellationRequested) return null;
      const version = doc.version;
      await documents.sync(doc);
      const point = { line: position.lineNumber - 1, character: position.column - 1 };
      const r = await callPython(
        'python.hover',
        {
          sessionId: doc.session.id,
          path: doc.path,
          position: point,
        },
        token,
      );
      if (!r || token.isCancellationRequested || doc.version !== version) return null;
      const link = (target: (typeof r.definitions)[number]['symbol'], label = target.name) =>
        `[${label.replace(/[\\`*_{}\[\]()<>]/g, '\\$&')}](${definitionLink(doc, point, target)})`;
      const target = r.definitions[0]?.symbol;
      return {
        range: r.range ? range(r.range) : undefined,
        contents: [
          ...r.definitions.map((definition) => {
            const context = [definition.module, ...definition.containers]
              .map((scope) => `${scope.kind === 5 ? '$(symbol-class) ' : ''}${link(scope)}`)
              .join(' · ');
            const candidate =
              r.definitions.length > 1
                ? ` · ${link(definition.symbol, `${definition.symbol.name}:${definition.symbol.position.line + 1}`)}`
                : '';
            return {
              value: `$(folder) ${context}${candidate}`,
              supportThemeIcons: true,
              isTrusted: definitionTrust,
            };
          }),
          { value: r.markdown, isTrusted: false },
          ...(target
            ? [
                {
                  value: link(
                    target,
                    `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} click to open definition`,
                  ),
                  isTrusted: definitionTrust,
                },
              ]
            : []),
        ],
      };
    } catch {
      return null;
    }
  },
});

monaco.languages.registerDefinitionProvider('python', {
  provideDefinition: async (model, position, token) => {
    try {
      const r = await request(model, 'textDocument/definition', token, position);
      if (!r || token.isCancellationRequested) return [];
      return (Array.isArray(r) ? r : [r]).map((d: any) => ({
        uri: monaco.Uri.parse(d.uri ?? d.targetUri),
        range: range(d.range ?? d.targetSelectionRange),
      }));
    } catch {
      return [];
    }
  },
});

monaco.languages.registerDocumentSymbolProvider('python', {
  provideDocumentSymbols: async (model, token) => {
    try {
      const r = await request(model, 'textDocument/documentSymbol', token);
      if (token.isCancellationRequested) return [];
      const convert = (s: any): monaco.languages.DocumentSymbol => ({
        name: s.name,
        detail: s.detail ?? '',
        kind: monaco.languages.SymbolKind.Class,
        tags: [],
        range: range(s.range ?? s.location.range),
        selectionRange: range(s.selectionRange ?? s.range ?? s.location.range),
        children: s.children?.map(convert),
      });
      return (r ?? []).map(convert);
    } catch {
      return [];
    }
  },
});
