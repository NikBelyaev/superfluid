export function PanelResizeHandle({
  variable,
  reverse = false,
}: {
  variable: string;
  reverse?: boolean;
}) {
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label="Resize panel"
      aria-orientation="vertical"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const value =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) ||
            280;
          document.documentElement.style.setProperty(
            variable,
            Math.max(200, Math.min(650, value + (e.key === 'ArrowRight' ? 10 : -10))) + 'px',
          );
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const initial = e.clientX,
          start =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) ||
            280;
        const move = (event: PointerEvent) =>
          document.documentElement.style.setProperty(
            variable,
            Math.max(200, Math.min(650, start + (event.clientX - initial) * (reverse ? -1 : 1))) +
              'px',
          );
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, { once: true });
      }}
    />
  );
}
