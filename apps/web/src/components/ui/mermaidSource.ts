export function escapeSequenceMessageSemicolons(source: string) {
  if (!/^\s*sequenceDiagram\b/m.test(source)) return source;
  return source.replace(/^([^\r\n:]+:)([^\r\n]*)$/gm, (line, prefix: string, text: string) => {
    if (!/[-=]+(?:>|x|\))|^\s*note\b/i.test(prefix)) return line;
    return (
      prefix +
      text.replace(/(#[\w]+;)|;/g, (_match, entity: string | undefined) => entity ?? '#59;')
    );
  });
}
