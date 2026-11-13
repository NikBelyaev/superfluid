export function layoutHover(card: HTMLElement) {
  const contents = card.querySelector<HTMLElement>(
    ':scope > .monaco-scrollable-element > .monaco-hover-content',
  );
  if (!contents) return false;
  const actions = contents.querySelector<HTMLElement>(
    '.markdown-hover:has(a[data-href^="command:superfluid.symbolAction"])',
  );
  const status = contents.querySelector<HTMLElement>('.hover-row.status-bar');
  if (!actions && !status) return false;
  let changed = false;
  let body = contents.querySelector<HTMLElement>(':scope > .editor-hover-body');
  let footer = contents.querySelector<HTMLElement>(':scope > .editor-hover-footer');
  if (!body || !footer) {
    body = document.createElement('div');
    body.className =
      'editor-hover-body min-h-0 min-w-0 flex-auto overscroll-contain overflow-auto outline-none';
    body.tabIndex = 0;
    body.setAttribute('aria-label', 'Documentation');
    footer = document.createElement('div');
    footer.className =
      'editor-hover-footer box-border flex h-9 shrink-0 items-center border-0 border-t border-solid border-border bg-popover px-2';
    for (const node of [body, footer])
      node.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    contents.append(body, footer);
    changed = true;
  }
  for (const row of [...contents.children]) {
    if (row === body || row === footer) continue;
    body.append(row);
    changed = true;
  }
  for (const part of [actions, status]) {
    if (!part || part.parentElement === footer) continue;
    footer.append(part);
    changed = true;
  }
  return changed;
}

export function scrollHover(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey) return;
  const card = event.target instanceof Element ? event.target.closest('.monaco-hover') : null;
  const body = card?.querySelector<HTMLElement>('.editor-hover-body');
  if (!body) return;
  let key = event.key;
  if (event.altKey || event.metaKey || event.ctrlKey) {
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
    const modifier = navigator.platform.includes('Mac')
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (event.altKey && !event.metaKey && !event.ctrlKey)
      key = key === 'ArrowUp' ? 'PageUp' : 'PageDown';
    else if (modifier && !event.altKey) key = key === 'ArrowUp' ? 'Home' : 'End';
    else return;
  }
  switch (key) {
    case 'ArrowUp':
      body.scrollTop -= 20;
      break;
    case 'ArrowDown':
      body.scrollTop += 20;
      break;
    case 'ArrowLeft':
      body.scrollLeft -= 30;
      break;
    case 'ArrowRight':
      body.scrollLeft += 30;
      break;
    case 'PageUp':
      body.scrollTop -= body.clientHeight;
      break;
    case 'PageDown':
      body.scrollTop += body.clientHeight;
      break;
    case 'Home':
      body.scrollTop = 0;
      break;
    case 'End':
      body.scrollTop = body.scrollHeight;
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}
