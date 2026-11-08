function text(value: string) {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
      if (name[0] !== '#') return entities[name.toLowerCase()] ?? entity;
      const code =
        name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    });
}

export function gitLabActivity(body: string) {
  const commits: { sha: string; title: string }[] = [];
  const normalized = body.replace(/<ul>([\s\S]*?)<\/ul>/gi, (_list, items: string) =>
    Array.from(items.matchAll(/<li>([\s\S]*?)<\/li>/gi))
      .flatMap((item) => {
        const value = text(item[1]);
        const commit = /^([a-f0-9]{7,64})\s+-\s+([\s\S]+)$/i.exec(value);
        if (!commit) return [`- ${value}`];
        commits.push({ sha: commit[1], title: commit[2] });
        return [];
      })
      .join('\n'),
  );
  if (!commits.length) return { body: normalized.trim() };
  const [action, ...rest] = normalized.trim().split(/\n\s*\n/);
  return { action, body: rest.join('\n\n'), commits };
}
