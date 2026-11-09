import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

function position(popup: HTMLElement, left: number, top: number) {
  const { width, height } = popup.getBoundingClientRect();
  popup.style.setProperty(
    '--search-left',
    `${Math.max(16, Math.min(innerWidth - width - 16, left))}px`,
  );
  popup.style.setProperty(
    '--search-top',
    `${Math.max(16, Math.min(innerHeight - height - 16, top))}px`,
  );
}

export function useSearchWindow() {
  const popup = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const toggle = () => {
    for (const property of ['width', 'height', '--search-left', '--search-top'])
      popup.current?.style.removeProperty(property);
    setExpanded(!expanded);
  };
  useEffect(() => {
    const fit = () => {
      const node = popup.current;
      if (
        !node ||
        node.dataset.expanded === 'true' ||
        !node.style.getPropertyValue('--search-left')
      )
        return;
      const { left, top } = node.getBoundingClientRect();
      position(node, left, top);
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const heading: HTMLAttributes<HTMLElement> = {
    role: 'toolbar',
    tabIndex: 0,
    'aria-label': 'Move search window',
    'aria-description':
      'Drag or use arrow keys to move. Double-click or press Enter to expand or restore.',
    title: 'Drag to move · Double-click to expand or restore',
    onPointerDown(event) {
      if (expanded || event.button !== 0 || (event.target as Element).closest('input, button, kbd'))
        return;
      event.preventDefault();
      const { left, top } = popup.current!.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left, top };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = 'true';
    },
    onPointerMove(event) {
      const start = drag.current;
      if (start)
        position(
          popup.current!,
          start.left + event.clientX - start.x,
          start.top + event.clientY - start.y,
        );
    },
    onLostPointerCapture(event) {
      drag.current = null;
      delete event.currentTarget.dataset.dragging;
    },
    onDoubleClick(event) {
      if (!(event.target as Element).closest('input, button, kbd')) toggle();
    },
    onKeyDown(event) {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        toggle();
        return;
      }
      if (expanded) return;
      const x = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
      const y = event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0;
      if (!x && !y) return;
      event.preventDefault();
      const { left, top } = popup.current!.getBoundingClientRect();
      position(popup.current!, left + x, top + y);
    },
  };
  return { popup, expanded, heading };
}
