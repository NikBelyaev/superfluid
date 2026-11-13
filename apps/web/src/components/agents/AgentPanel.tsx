import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function AgentPanel({
  open,
  children,
  chat = false,
  id,
}: {
  open: boolean;
  children: ReactNode;
  chat?: boolean;
  id?: string;
}) {
  const [retained, setRetained] = useState(open ? children : null);
  const root = useRef<HTMLDivElement>(null);
  if (open && retained !== children) setRetained(children);
  const present = retained !== null;
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    if (open) {
      if (chat) node.querySelector('textarea')?.focus({ preventScroll: true });
      return;
    }
    if (!present) return;
    let cancelled = false;
    void node.offsetHeight;
    const animations = node
      .getAnimations({ subtree: true })
      .filter((a) => Number.isFinite(a.effect?.getComputedTiming().iterations));
    void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
      if (!cancelled) setRetained(null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, present, chat]);
  return (
    <div
      ref={root}
      id={id}
      inert={!open}
      aria-hidden={!open || undefined}
      data-open={open || undefined}
      className={`group/panel grid overflow-clip transition-[grid-template-rows,margin] duration-[260ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'} ${chat ? `-mx-1 rounded-b-[17px] ${open ? 'mt-1 -mb-1' : 'my-0'}` : ''}`}
    >
      <div className="min-h-0">
        <div
          className={
            chat
              ? undefined
              : `transition-[transform,opacity] duration-[260ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${open ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`
          }
        >
          {retained}
        </div>
      </div>
    </div>
  );
}
