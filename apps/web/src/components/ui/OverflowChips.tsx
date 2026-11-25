import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

const countClass =
  'inline-flex h-5 shrink-0 items-center rounded-full border border-solid border-border bg-card px-1.5 font-mono text-[length:var(--text-2xs)] whitespace-nowrap text-muted-foreground tabular-nums';

export function fitChips(
  widths: number[],
  countWidths: number[],
  gap: number,
  available: number,
  overlap = false,
) {
  let start = 0;
  let visible = 0;
  let showPartial = false;
  const badge = (hidden: number) => (hidden ? countWidths[String(hidden).length - 1] : 0);
  for (const [index, width] of widths.entries()) {
    const hidden = widths.length - index - 1;
    const uncovered = available - start - badge(hidden) - (hidden && !overlap ? gap : 0);
    if (uncovered >= width || (overlap && uncovered >= width * 0.4)) {
      visible = index + 1;
      showPartial = uncovered < width;
    }
    start += width + gap;
  }
  const hidden = widths.length - visible;
  return { visible, hidden, badgeWidth: badge(hidden), showPartial };
}

type Chip = { key: string; label: string; content: ReactNode };

type ChipMove = {
  id: number;
  absorbing: boolean;
  fromCount: number;
  fromWidth: number;
  first: number;
  end: number;
  start: number;
};
type ChipLayout = ReturnType<typeof fitChips> & { previousHidden: number; move?: ChipMove };

function RollingCount({ value, previous }: { value: number; previous: number }) {
  const digits = String(value);
  const oldDigits = String(previous).slice(-digits.length).padStart(digits.length, ' ');
  return (
    <>
      <span className="sr-only">+{value}</span>
      <span
        className={`inline-flex items-center ${value < previous ? '[--chip-digit-offset:-105%]' : ''}`}
        aria-hidden="true"
      >
        +
        {[...digits].map((digit, index) =>
          digit === oldDigits[index] ? (
            <span key={index}>{digit}</span>
          ) : (
            <span
              className="relative inline-block h-[1em] w-[1ch] overflow-hidden leading-none"
              key={index}
            >
              <span className="block motion-safe:animate-chip-digit-in">{digit}</span>
              <span className="absolute inset-0 motion-safe:animate-chip-digit-out motion-reduce:hidden">
                {oldDigits[index]}
              </span>
            </span>
          ),
        )}
      </span>
    </>
  );
}

export function OverflowChips({ chips, overlap = false }: { chips: Chip[]; overlap?: boolean }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const metrics = useRef<HTMLSpanElement>(null);
  const [{ visible, hidden, badgeWidth, showPartial, previousHidden, move }, setFit] =
    useState<ChipLayout>({
      visible: chips.length,
      hidden: 0,
      badgeWidth: 0,
      showPartial: false,
      previousHidden: 0,
    });

  useLayoutEffect(() => {
    const frame = viewport.current!;
    const row = track.current!;
    const items = Array.from(row.querySelectorAll<HTMLElement>('[data-overflow-chip]'));
    const counts = Array.from(metrics.current!.children);
    const gap = parseFloat(getComputedStyle(row).columnGap);
    const elements = [frame, ...items, ...counts];
    const sizes = new Map<Element, number>();
    let measured = false;
    let inViewport = false;
    const document = frame.ownerDocument;
    const motion = document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
    const stopAnimation = () =>
      setFit((state) =>
        !state.move && state.previousHidden === state.hidden
          ? state
          : { ...state, previousHidden: state.hidden, move: undefined },
      );
    const onVisibility = () => {
      if (document.hidden) stopAnimation();
    };
    const onMotion = () => {
      if (motion?.matches) stopAnimation();
    };
    const visibility = overlap
      ? new IntersectionObserver(([entry]) => {
          inViewport = entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
          if (!inViewport) stopAnimation();
        })
      : undefined;
    if (visibility) {
      visibility.observe(frame);
      document.addEventListener('visibilitychange', onVisibility);
      motion?.addEventListener('change', onMotion);
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) sizes.set(entry.target, entry.borderBoxSize[0].inlineSize);
      if (sizes.size !== elements.length) return;
      const animate = measured && inViewport && !document.hidden && !motion?.matches;
      measured = true;
      const widths = items.map((item) => sizes.get(item)!);
      const fit = fitChips(
        widths,
        counts.map((count) => sizes.get(count)!),
        gap,
        sizes.get(frame)!,
        overlap,
      );
      setFit((previous) => {
        if (
          previous.visible === fit.visible &&
          previous.hidden === fit.hidden &&
          previous.showPartial === fit.showPartial &&
          previous.badgeWidth === fit.badgeWidth
        )
          return previous;
        if (!animate) return { ...fit, previousHidden: fit.hidden, move: undefined };
        if (fit.hidden === previous.hidden) return { ...previous, ...fit };

        const fromCount = previous.move?.absorbing ? previous.move.fromCount : previous.hidden;
        const absorbing = fit.hidden > fromCount;
        const fromVisible = absorbing ? chips.length - fromCount : previous.visible;
        const first = Math.min(fit.visible, fromVisible);
        return {
          ...fit,
          previousHidden: fromCount,
          move: {
            id: (previous.move?.id ?? 0) + 1,
            absorbing,
            fromCount,
            fromWidth: fromCount === 0 ? 0 : previous.badgeWidth,
            first,
            end: Math.max(fit.visible, fromVisible),
            start: widths.slice(0, first).reduce((offset, width) => offset + width + gap, 0),
          },
        };
      });
    });
    for (const element of elements) observer.observe(element, { box: 'border-box' });
    return () => {
      observer.disconnect();
      visibility?.disconnect();
      if (visibility) {
        document.removeEventListener('visibilitychange', onVisibility);
        motion?.removeEventListener('change', onMotion);
      }
    };
  }, [chips, overlap]);

  const displayedCount = move?.absorbing ? move.fromCount : hidden;
  const exiting = !!move && hidden === 0 && move.fromCount > 0;
  const firstAbsorption = move?.absorbing && displayedCount === 0;
  const countWidth = firstAbsorption ? 0 : badgeWidth;
  const value = exiting ? move.fromCount : displayedCount;
  const animateCount = overlap && !exiting && displayedCount !== previousHidden;
  const animation = exiting
    ? 'motion-safe:animate-chip-count-exit'
    : animateCount
      ? displayedCount > previousHidden
        ? 'motion-safe:animate-chip-count-pulse'
        : 'motion-safe:animate-chip-count-shrink'
      : '';
  const clipAnimation =
    move && move.fromWidth !== countWidth
      ? move.absorbing
        ? 'motion-safe:animate-chip-clip-absorb'
        : 'motion-safe:animate-chip-clip-reveal'
      : '';
  const fadeAtEdge = overlap && (firstAbsorption || (showPartial && hidden === 0));
  const count = value > 0 && (
    <span
      key={value}
      data-overflow-count={displayedCount || undefined}
      aria-hidden={exiting || undefined}
      className={`${countClass} ${overlap ? 'absolute end-0 top-1/2 z-10 -translate-y-1/2' : ''} ${animation} ${exiting ? 'pointer-events-none' : ''}`}
      title={
        displayedCount
          ? chips
              .slice(-displayedCount)
              .map(({ label }) => label)
              .join(', ')
          : undefined
      }
    >
      {animateCount && previousHidden > 0 ? (
        <RollingCount value={value} previous={previousHidden} />
      ) : (
        `+${value}`
      )}
    </span>
  );

  return (
    <span ref={viewport} className="relative block">
      <span
        className={`relative block overflow-hidden ${overlap ? '[clip-path:inset(0_var(--chip-count-width)_0_0)]' : ''} ${fadeAtEdge ? '[mask-image:linear-gradient(to_right,black_calc(100%_-_16px),transparent)]' : ''} ${clipAnimation}`}
        style={
          overlap
            ? ({
                '--chip-count-width': `${countWidth}px`,
                '--chip-previous-width': move ? `${move.fromWidth}px` : undefined,
              } as CSSProperties)
            : undefined
        }
      >
        <span ref={track} className="flex w-max items-center gap-1">
          {chips.map(({ key, content }, index) => {
            const moving = move && index >= move.first && index < move.end;
            return (
              <Fragment key={key}>
                {!overlap && index === visible && count}
                <span
                  data-overflow-chip=""
                  aria-hidden={index >= visible || undefined}
                  className={`shrink-0 ${index >= visible ? 'invisible' : moving ? 'opacity-0' : ''}`}
                >
                  {content}
                </span>
              </Fragment>
            );
          })}
        </span>
        {move && (
          <span
            key={move.id}
            data-overflow-motion={move.absorbing ? 'absorb' : 'reveal'}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 flex w-full items-center gap-1 ps-(--chip-start) ${move.absorbing ? 'motion-safe:animate-chip-absorb' : 'motion-safe:animate-chip-reveal'}`}
            style={{ '--chip-start': `${move.start}px` } as CSSProperties}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) {
                setFit((state) => (state.move === move ? { ...state, move: undefined } : state));
              }
            }}
          >
            {chips.slice(move.first, move.end).map(({ key, content }) => (
              <span key={key} className="shrink-0">
                {content}
              </span>
            ))}
          </span>
        )}
      </span>
      {overlap && displayedCount > 0 && (
        <span
          className="overflow-fade absolute inset-y-0 w-2"
          style={{ insetInlineEnd: badgeWidth }}
          aria-hidden="true"
        />
      )}
      {overlap &&
        (exiting ? (
          <span className="pointer-events-none absolute inset-x-0 -inset-y-1 overflow-hidden">
            {count}
          </span>
        ) : (
          count
        ))}
      <span
        ref={metrics}
        className="invisible absolute start-0 top-0 flex w-max"
        aria-hidden="true"
      >
        {Array.from({ length: String(chips.length).length }, (_, index) => (
          <span className={countClass} key={index}>
            +{'0'.repeat(index + 1)}
          </span>
        ))}
      </span>
    </span>
  );
}
