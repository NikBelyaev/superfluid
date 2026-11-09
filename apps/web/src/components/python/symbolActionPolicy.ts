import type { PythonDefinition, PythonLocation } from '@superfluid/contracts';

const keywords = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' ',
  ),
);

export type SymbolAction =
  | 'rename'
  | 'rename-alias'
  | 'definition'
  | 'choose-definition'
  | 'search'
  | 'copy'
  | 'copy-name'
  | 'delete';

export function isSymbolDeclaration(
  { symbol }: PythonDefinition,
  uri: string,
  position: PythonLocation['position'],
  name: string,
) {
  if (symbol.uri !== uri) return false;
  if (symbol.position.line === position.line && symbol.position.character === position.character)
    return true;
  const range = symbol.range;
  return (
    range?.start.line === position.line &&
    range.start.character <= position.character &&
    range.end.line === position.line &&
    range.end.character === position.character + name.length
  );
}

export function symbolActionPolicy({
  name,
  prefix,
  uri,
  position,
  definitions,
}: {
  name: string;
  prefix: string;
  uri: string;
  position: PythonLocation['position'];
  definitions: PythonDefinition[];
}): SymbolAction[] {
  if (!/^[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(name) || keywords.has(name)) return [];
  if (!definitions.length) return ['search', 'copy-name'];
  if (/\bas\s+$/.test(prefix))
    return [
      'rename-alias',
      definitions.length === 1 ? 'definition' : 'choose-definition',
      'search',
    ];
  const local = definitions.filter((definition) => definition.symbol.uri === uri);
  const first = local.toSorted(
    (a, b) =>
      a.symbol.position.line - b.symbol.position.line ||
      a.symbol.position.character - b.symbol.position.character,
  )[0];
  const declaration = first && isSymbolDeclaration(first, uri, position, name);
  if (declaration) {
    return /^\s*(?:async\s+)?(?:def|class)\s+$/.test(prefix)
      ? ['rename', 'search', 'copy', 'delete']
      : ['rename', 'search', 'copy'];
  }
  return definitions.length === 1
    ? ['definition', 'search', 'copy']
    : ['choose-definition', 'search', 'copy-name'];
}

export function symbolReference(definition: PythonDefinition, name: string) {
  return [
    definition.module.name,
    ...definition.containers.map((scope) => scope.name),
    definition.symbol.name,
    ...(definition.binding ? [name] : []),
  ].join('.');
}
