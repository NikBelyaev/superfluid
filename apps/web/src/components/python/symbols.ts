export interface DocumentSymbol {
  name: string;
  kind: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: DocumentSymbol[];
}

export function symbolAt(
  symbols: DocumentSymbol[],
  line: number,
  character: number,
): { name: string; kind: number } | undefined {
  for (const symbol of symbols) {
    const { start, end } = symbol.range;
    if (
      (line > start.line || (line === start.line && character >= start.character)) &&
      (line < end.line || (line === end.line && character < end.character))
    ) {
      const child = symbolAt(symbol.children ?? [], line, character);
      return child
        ? { ...child, name: `${symbol.name}.${child.name}` }
        : { name: symbol.name, kind: symbol.kind };
    }
  }
}
