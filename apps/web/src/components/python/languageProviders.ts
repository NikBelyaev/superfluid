import { callPython } from '~/rpc/python';
import { documents, monaco, type Doc } from '~/state/editor/Documents';
import { definitionLink, definitionTrust } from './definitionPreview';
import { symbolActions } from './symbolActions';
import { completionLabel } from './completionLabel';
import { pythonGeneration } from '~/state/python';
import { useApp } from '~/state/workspaceStore';

type CompletionEdit = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
};
type Completion = {
  label: string;
  kind?: number;
  labelDetails?: { detail?: string; description?: string };
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: Partial<CompletionEdit> & {
    newText: string;
    insert?: CompletionEdit['range'];
    replace?: CompletionEdit['range'];
  };
  additionalTextEdits?: CompletionEdit[];
  sortText?: string;
  filterText?: string;
  data?: unknown;
};
const completions = new WeakMap<
  monaco.languages.CompletionItem,
  { doc: Doc; generation: number; raw: Completion }
>();
const documentation = (value: Completion['documentation']) =>
  typeof value === 'string' || !value
    ? value
    : value.kind === 'markdown'
      ? { value: value.value, isTrusted: false }
      : value.value;
const additionalEdits = (item: Completion) =>
  item.additionalTextEdits?.map((edit) => ({ range: range(edit.range), text: edit.newText }));

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

const completionKinds = [
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter',
] as const;

monaco.languages.registerCompletionItemProvider('python', {
  triggerCharacters: ['.'],
  provideCompletionItems: async (model, position, context, token) => {
    try {
      const result = await request(model, 'textDocument/completion', token, position, {
        context: {
          triggerKind: context.triggerKind + 1,
          triggerCharacter: context.triggerCharacter,
        },
      });
      const doc = documents.find(model);
      if (!doc || doc.closed || token.isCancellationRequested) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const items: Completion[] = result?.items ?? result ?? [];
      return {
        suggestions: items.slice(0, 300).map((i) => {
          const editRange = i.textEdit?.range ?? i.textEdit?.replace ?? i.textEdit?.insert;
          const item = {
            label: completionLabel(i),
            kind: monaco.languages.CompletionItemKind[completionKinds[(i.kind ?? 1) - 1] ?? 'Text'],
            detail: i.detail,
            documentation: documentation(i.documentation),
            insertText: i.textEdit?.newText ?? i.insertText ?? i.label,
            insertTextRules:
              i.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : 0,
            range: editRange
              ? range(editRange)
              : new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn,
                ),
            sortText: i.sortText,
            filterText: i.filterText,
            additionalTextEdits: additionalEdits(i),
          };
          completions.set(item, { doc, generation: pythonGeneration(doc.session.id), raw: i });
          return item;
        }),
      };
    } catch {
      return { suggestions: [] };
    }
  },
  resolveCompletionItem: async (item, token) => {
    const context = completions.get(item);
    if (!context || context.raw.data === undefined || context.raw.additionalTextEdits?.length)
      return item;
    const { doc, generation } = context;
    const current = () =>
      !token.isCancellationRequested &&
      !doc.closed &&
      !doc.model.isDisposed() &&
      pythonGeneration(doc.session.id) === generation &&
      useApp.getState().sessionId === doc.session.id;
    if (!current()) return item;
    const resolved: Completion = await callPython(
      'lsp.request',
      {
        sessionId: doc.session.id,
        method: 'completionItem/resolve',
        params: { ...context.raw, textDocument: { uri: documents.diskUri(doc) } },
      },
      token,
    );
    if (!current()) return item;
    item.label = completionLabel(resolved);
    item.detail = resolved.detail;
    item.documentation = documentation(resolved.documentation);
    item.additionalTextEdits = additionalEdits(resolved);
    return item;
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
      const link = (
        target: (typeof r.definitions)[number]['symbol'],
        label = target.name,
        title = '',
      ) =>
        `[${label.replace(/[\\`*_{}\[\]()<>]/g, '\\$&')}](${definitionLink(doc, point, target)}${title ? ` "${title}"` : ''})`;
      return {
        range: r.range ? range(r.range) : undefined,
        contents: [
          ...r.definitions.map((definition) => {
            const context = [definition.module, ...definition.containers]
              .map((scope) => `${scope.kind === 5 ? '$(symbol-class) ' : ''}${link(scope)}`)
              .join(' · ');
            const multiple = r.definitions.length > 1;
            const label = [...definition.containers, definition.symbol]
              .map((symbol) => symbol.name)
              .join('.');
            const file = decodeURIComponent(definition.symbol.uri.split('/').at(-1) ?? '');
            return {
              value: multiple
                ? `${link(definition.symbol, label, 'Open definition')}\n\n\`${file}:${definition.symbol.position.line + 1}\``
                : `$(file) ${context}`,
              supportThemeIcons: true,
              isTrusted: definitionTrust,
            };
          }),
          ...(r.definitions.length > 1
            ? []
            : [
                {
                  value: /^```\w*\s+Unknown\s+```$/.test(r.markdown.trim())
                    ? '`Unknown`'
                    : r.markdown,
                  isTrusted: false,
                },
              ]),
          ...(r.definitions.length ? [symbolActions(doc, point, r)] : []),
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
