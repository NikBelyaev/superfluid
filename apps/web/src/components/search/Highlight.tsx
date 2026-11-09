export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts = [];
  let from = 0;
  let match = lower.indexOf(needle);
  while (match >= 0) {
    parts.push(
      text.slice(from, match),
      <mark key={match} className="rounded-[2px] bg-foreground/12 text-inherit">
        {text.slice(match, match + query.length)}
      </mark>,
    );
    from = match + query.length;
    match = lower.indexOf(needle, from);
  }
  parts.push(text.slice(from));
  return parts;
}
