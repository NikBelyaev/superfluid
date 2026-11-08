import type { PythonDocumentSymbol as DocumentSymbol } from '@superfluid/contracts';
import type { Location } from '~/state/workspaceView';
export type { DocumentSymbol };

export function symbolAt(
  symbols: DocumentSymbol[],
  line: number,
  character: number,
): { name: string; kind: number; range: DocumentSymbol['range'] } | undefined {
  for (const symbol of symbols) {
    const { start, end } = symbol.range;
    if (
      (line > start.line || (line === start.line && character >= start.character)) &&
      (line < end.line || (line === end.line && character < end.character))
    ) {
      const child = symbolAt(symbol.children ?? [], line, character);
      return child
        ? { ...child, name: `${symbol.name}.${child.name}` }
        : { name: symbol.name, kind: symbol.kind, range: symbol.range };
    }
  }
}

export function sameSymbol(
  symbols: DocumentSymbol[],
  from: Pick<Location, 'path' | 'line' | 'column'>,
  to: Pick<Location, 'path' | 'line' | 'column'>,
) {
  if (from.path !== to.path) return false;
  if (from.line === to.line && from.column === to.column) return true;
  const origin = symbolAt(symbols, from.line - 1, from.column - 1);
  const destination = symbolAt(symbols, to.line - 1, to.column - 1);
  return !!origin && origin.range === destination?.range;
}
