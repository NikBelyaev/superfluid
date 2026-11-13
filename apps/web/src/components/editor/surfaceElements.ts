const normalKeySize = 'h-5! min-w-[22px]! px-1.5! text-[11px]! leading-5!';
const keyVariants = {
  normal: normalKeySize,
  compact: 'h-[17px]! min-w-[17px]! px-1! text-[10px]! leading-[17px]!',
  choice: `${normalKeySize} col-start-2 row-start-1 m-0! w-[var(--editor-choice-shortcut-width,28px)]! self-start`,
  action: `${normalKeySize} col-start-2 row-start-1 m-0! w-[var(--editor-shortcut-width,56px)]! self-center`,
};
const fadedTextClasses =
  'block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]';

export const iconActionClasses =
  'editor-icon-action inline-flex! size-7! min-h-0! shrink-0 items-center! justify-center! gap-0! rounded-[var(--control-radius)] border-0! p-0! leading-none! text-muted-foreground shadow-none hover:bg-accent hover:text-foreground [&_.codicon]:m-0! [&_.codicon]:block! [&_.codicon]:size-3.5 [&_.codicon]:shrink-0 [&_.codicon]:text-sm! [&_.codicon]:leading-none!';

export function keycap(label: string, variant: keyof typeof keyVariants = 'normal') {
  const key = document.createElement('kbd');
  key.className = `editor-keycap inline-flex! shrink-0! items-center! justify-center! rounded! border-0! bg-foreground/7! py-0! align-middle! font-sans! font-medium! tracking-normal! text-muted-foreground! shadow-none! ${keyVariants[variant]}`;
  key.textContent = label.replace(/^\^/, '⌃').replaceAll('⏎', '↵');
  key.setAttribute('aria-hidden', 'true');
  return key;
}

export function menuLabel(label: string) {
  const name = document.createElement('span');
  name.className = `editor-menu-label ${fadedTextClasses}`;
  name.textContent = label;
  return name;
}

export function numberedShortcut(index: number) {
  return index < 9 ? `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}${index + 1}` : '';
}

export function choiceRow(row: HTMLElement, label: string, shortcut: string, detail?: string) {
  row.classList.add(
    ...'editor-choice-row grid min-h-[38px] w-full grid-cols-[minmax(0,1fr)_var(--editor-choice-shortcut-width,28px)] cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-1 text-left font-mono text-xs leading-5 text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:text-muted-foreground aria-selected:bg-accent group-[.pointer-active]/choices:enabled:hover:bg-accent!'.split(
      ' ',
    ),
    detail ? 'py-1' : 'py-2',
  );
  row.setAttribute('aria-label', label);
  const text = document.createElement('span');
  text.className = 'editor-menu-text flex min-w-0 flex-col gap-0.5 overflow-hidden';
  text.append(menuLabel(label));
  if (detail) {
    row.setAttribute('aria-description', detail);
    const secondary = document.createElement('span');
    secondary.className = `editor-menu-detail ${fadedTextClasses} font-sans text-[11px] leading-4 text-muted-foreground`;
    secondary.textContent = detail;
    text.append(secondary);
  }
  row.replaceChildren(text);
  if (shortcut) {
    row.setAttribute(
      'aria-keyshortcuts',
      shortcut.replace('⌘', 'Meta+').replace('Ctrl+', 'Control+'),
    );
    row.append(keycap(shortcut, 'choice'));
  }
}

export function keyHint(label: string, ...keys: string[]) {
  const hint = document.createElement('span');
  hint.className = 'editor-key-hint inline-flex items-center gap-1';
  hint.append(...keys.map((key) => keycap(key, 'compact')), document.createTextNode(label));
  return hint;
}

export function choiceFooter() {
  const footer = document.createElement('div');
  footer.className =
    'editor-choice-footer flex items-center gap-3 border-0 border-t border-solid border-border bg-popover px-3 py-1 font-sans text-[10px] text-muted-foreground';
  const escape = keycap('Esc', 'compact');
  escape.classList.add('editor-escape-key', 'ml-auto');
  footer.append(keyHint('Choose', '↑', '↓'), keyHint('Apply', '↵'), escape);
  return footer;
}
