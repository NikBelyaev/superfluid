export function completionLabel(item: {
  label: string;
  detail?: string;
  labelDetails?: { detail?: string; description?: string };
  additionalTextEdits?: { newText: string }[];
}) {
  let source =
    item.labelDetails?.description !== item.detail ? item.labelDetails?.description : undefined;
  if (!source)
    for (const edit of item.additionalTextEdits ?? []) {
      const imported = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/m.exec(edit.newText);
      if (imported) {
        source = imported[1] ?? imported[2];
        break;
      }
    }
  const label = {
    label: item.label,
    ...(source && source !== item.label ? { description: source } : {}),
  };
  const detail = (item.labelDetails?.detail ?? item.detail)?.trim();
  if (!detail || /^\(import .+\)$/.test(detail)) return label;
  const representation = /^<(class|module) ['"](.+)['"]>$/.exec(detail);
  if (representation)
    return representation[1] === 'module' && representation[2] !== item.label
      ? { ...label, description: representation[2] }
      : label;
  if (detail.startsWith('(')) return { ...label, detail };
  const name = item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[.\\s])${name}(?=[(:\\[])`).exec(detail);
  if (match) return { ...label, detail: detail.slice(match.index + match[0].length) };
  if (!/^(?:bound method|def|class|module)\b/.test(detail) && detail !== item.label)
    return { ...label, detail: `: ${detail}` };
  return label;
}
