import type { GoRange } from '@superfluid/contracts';
import { completionKind } from '~/components/editor/completionKind';
import { requestGo } from '~/rpc/go';
import { documents, monaco } from '~/state/editor/Documents';

const point = (position: monaco.Position) => ({
  line: position.lineNumber - 1,
  character: position.column - 1,
});
const range = ({ start, end }: GoRange) =>
  new monaco.Range(start.line + 1, start.character + 1, end.line + 1, end.character + 1);

monaco.languages.registerCompletionItemProvider('go', {
  triggerCharacters: ['.'],
  provideCompletionItems: async (model, position, _context, token) => {
    const doc = documents.find(model);
    if (!doc) return;
    const result = await requestGo('go.completion', doc, point(position), token).catch(
      () => undefined,
    );
    if (!result) return;
    const word = model.getWordUntilPosition(position);
    return {
      incomplete: result.isIncomplete,
      suggestions: result.items.map((item) => {
        const edit = item.textEdit;
        return {
          label: item.label,
          kind: completionKind(item.kind),
          detail: item.detail,
          documentation:
            typeof item.documentation === 'object'
              ? { value: item.documentation.value, isTrusted: false }
              : item.documentation,
          filterText: item.filterText,
          sortText: item.sortText,
          insertText: edit?.newText ?? item.insertText ?? item.label,
          insertTextRules:
            item.insertTextFormat === 2
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range: !edit
            ? new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              )
            : 'range' in edit
              ? range(edit.range)
              : { insert: range(edit.insert), replace: range(edit.replace) },
          additionalTextEdits: item.additionalTextEdits?.map((extra) => ({
            range: range(extra.range),
            text: extra.newText,
          })),
        };
      }),
    };
  },
});

monaco.languages.registerHoverProvider('go', {
  provideHover: async (model, position, token) => {
    const doc = documents.find(model);
    if (!doc) return;
    const hover = await requestGo('go.hover', doc, point(position), token).catch(() => undefined);
    if (!hover) return;
    return {
      range: hover.range && range(hover.range),
      contents: [{ value: hover.contents.value, isTrusted: false }],
    };
  },
});

monaco.languages.registerDefinitionProvider('go', {
  provideDefinition: async (model, position, token) => {
    const doc = documents.find(model);
    if (!doc) return;
    const targets = await requestGo('go.definition', doc, point(position), token).catch(
      () => undefined,
    );
    return targets?.map((target) => ({
      uri: documents.uri(doc.session, target.path),
      range: range(target.range),
    }));
  },
});
