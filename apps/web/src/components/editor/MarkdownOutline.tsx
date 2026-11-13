import { useId, useLayoutEffect, useState, type RefObject } from 'react';

export function MarkdownOutline({
  preview,
  text,
}: {
  preview: RefObject<HTMLElement | null>;
  text: string;
}) {
  const [sections, setSections] = useState<
    { element: HTMLHeadingElement; title: string; summary: string | null }[]
  >([]);
  const [current, setCurrent] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const tooltip = useId();

  useLayoutEffect(() => {
    const container = preview.current;
    if (!container) return;
    const headings = Array.from(
      container.querySelectorAll<HTMLHeadingElement>('.markdown-document :is(h1,h2,h3,h4,h5,h6)'),
    );
    setSections(
      headings.map((element) => {
        const content = element.nextElementSibling;
        return {
          element,
          title: element.textContent ?? '',
          summary:
            content instanceof HTMLElement &&
            content.matches('p,ul,ol,blockquote,pre,.markdown-table')
              ? content.innerText
              : null,
        };
      }),
    );
    setHovered(null);
    const updateCurrent = () => {
      if (
        container.scrollTop > 0 &&
        container.scrollTop + container.clientHeight >= container.scrollHeight - 1
      ) {
        setCurrent(Math.max(0, headings.length - 1));
        return;
      }
      const top = container.getBoundingClientRect().top + 32;
      let low = 0;
      let high = headings.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (headings[middle].getBoundingClientRect().top <= top) low = middle + 1;
        else high = middle;
      }
      setCurrent(Math.max(0, low - 1));
    };
    updateCurrent();
    container.addEventListener('scroll', updateCurrent, { passive: true });
    return () => container.removeEventListener('scroll', updateCurrent);
  }, [preview, text]);

  if (sections.length < 2) return null;
  const selected = hovered === null ? null : sections[hovered];
  const select = (index: number) => {
    const heading = sections[index].element;
    heading.tabIndex = -1;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
    setCurrent(index);
  };
  const indexAt = (element: HTMLElement, y: number) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        sections.length - 1,
        Math.floor(((y - bounds.top) / bounds.height) * sections.length),
      ),
    );
  };

  return (
    <nav
      className="absolute top-1/2 left-2 z-1 max-h-[calc(100%-48px)] w-8 -translate-y-1/2"
      aria-label="Document outline"
      style={{ height: Math.max(24, sections.length * 8) }}
    >
      <button
        className="relative h-full w-full p-0"
        type="button"
        aria-label={`Jump to section: ${selected?.title ?? sections[current]?.title ?? ''}`}
        aria-describedby={selected ? tooltip : undefined}
        onFocus={() => setHovered(current)}
        onBlur={() => setHovered(null)}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(event) => setHovered(indexAt(event.currentTarget, event.clientY))}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) =>
          select(
            event.detail === 0 ? (hovered ?? current) : indexAt(event.currentTarget, event.clientY),
          )
        }
        onKeyDown={(event) => {
          const index = hovered ?? current;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(index);
          } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setHovered(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? sections.length - 1
                  : Math.max(
                      0,
                      Math.min(sections.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)),
                    ),
            );
          }
        }}
      >
        {sections.map((section, index) => (
          <span
            key={index}
            data-outline-mark
            data-current={index === current}
            data-hovered={index === hovered}
            data-distance={hovered === null ? undefined : Math.abs(index - hovered)}
            className="pointer-events-none absolute left-2 h-0.5 w-2 rounded-[1px] bg-muted-foreground opacity-40 data-[current=true]:bg-foreground data-[current=true]:opacity-100 data-[hovered=true]:w-6 data-[hovered=true]:opacity-100 data-[distance=1]:w-4 data-[distance=2]:w-3"
            aria-hidden="true"
            style={{ top: `${((index + 0.5) / sections.length) * 100}%` }}
          />
        ))}
        {selected && hovered !== null && (
          <span
            id={tooltip}
            role="tooltip"
            className="pointer-events-none absolute left-10 w-[min(320px,calc(100vw-96px))] -translate-y-1/2 rounded-(--floating-radius) border border-solid border-border bg-popover p-3 text-left text-sm leading-5 text-foreground shadow-(--shadow-popover)"
            style={{ top: `${((hovered + 0.5) / sections.length) * 100}%` }}
          >
            <span className="block truncate">{selected.title}</span>
            {selected.summary && (
              <span className="mt-1 line-clamp-3 text-muted-foreground">{selected.summary}</span>
            )}
          </span>
        )}
      </button>
    </nav>
  );
}
