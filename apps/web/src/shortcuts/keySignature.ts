export const keySignature = (
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code'>,
) =>
  [
    e.metaKey ? 'Meta' : '',
    e.ctrlKey ? 'Control' : '',
    e.altKey ? 'Alt' : '',
    e.shiftKey ? 'Shift' : '',
    e.code,
  ]
    .filter(Boolean)
    .join('+');
