import { monaco } from './monaco';
import { choiceFooter, choiceRow, numberedShortcut } from './surfaceElements';

const open = new WeakMap<monaco.editor.IStandaloneCodeEditor, () => void>();

export function showChoiceMenu(
  editor: monaco.editor.IStandaloneCodeEditor,
  items: readonly { label: string; disabled?: string }[],
  select: (index: number) => void,
) {
  open.get(editor)?.();
  const position = editor.getPosition();
  if (!position) return;
  const node = document.createElement('div');
  node.className =
    'editor-choice-menu group/choices w-64 max-w-[calc(100vw-32px)] overflow-hidden rounded-[var(--floating-radius)] border border-solid border-border bg-popover font-sans text-foreground shadow-[var(--shadow-popover)]';
  const list = document.createElement('div');
  list.className = 'editor-choice-list max-h-72 overflow-auto px-1.5 py-2';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Options');
  let selected = items.findIndex((item) => !item.disabled);
  const rows = items.map((item, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    choiceRow(row, item.label, numberedShortcut(index));
    row.disabled = !!item.disabled;
    if (item.disabled) row.title = item.disabled;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === selected));
    row.onclick = () => {
      close();
      editor.focus();
      select(index);
    };
    row.onpointermove = (event) => {
      if ((!event.movementX && !event.movementY) || row.disabled || selected === index) return;
      focus(index);
    };
    list.append(row);
    return row;
  });
  const focus = (index: number) => {
    selected = index;
    rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === selected)));
  };
  node.append(list, choiceFooter());
  const widget: monaco.editor.IContentWidget = {
    allowEditorOverflow: true,
    suppressMouseDown: true,
    getId: () => 'superfluid.choices',
    getDomNode: () => node,
    getPosition: () => ({
      position,
      preference: [
        monaco.editor.ContentWidgetPositionPreference.BELOW,
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
      ],
    }),
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open.delete(editor);
    root.removeEventListener('keydown', keyboard, true);
    document.removeEventListener('pointerdown', outside, true);
    for (const subscription of subscriptions) subscription.dispose();
    editor.removeContentWidget(widget);
  };
  const outside = (event: PointerEvent) => {
    if (event.target instanceof Node && !node.contains(event.target)) close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      close();
      editor.focus();
      return;
    }
    if (event.key === 'Enter') return rows[selected]?.click();
    const enabled = rows
      .map((row, index) => (!row.disabled ? index : -1))
      .filter((index) => index >= 0);
    if (!enabled.length) return;
    const next =
      enabled[
        (enabled.indexOf(selected) + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) %
          enabled.length
      ]!;
    focus(next);
    rows[selected]?.scrollIntoView({ block: 'nearest' });
  };
  const root = editor.getDomNode()!;
  const subscriptions = [
    editor.onDidChangeModel(close),
    editor.onDidChangeModelContent(close),
    editor.onDidChangeCursorPosition(close),
    editor.onDidBlurEditorWidget(close),
    editor.onDidDispose(close),
  ];
  root.addEventListener('keydown', keyboard, true);
  document.addEventListener('pointerdown', outside, true);
  open.set(editor, close);
  editor.addContentWidget(widget);
}
