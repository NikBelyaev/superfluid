import { memo, useLayoutEffect, useRef, useState } from 'react';

export const HistorySubject = memo(function HistorySubject({ subject }: { subject: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const frame = viewport.current!;
    const content = text.current!;
    const observer = new ResizeObserver(() => setClipped(frame.scrollWidth > frame.clientWidth));
    observer.observe(frame);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={viewport}
      className="relative min-w-0 flex-1 overflow-hidden ps-2 whitespace-nowrap"
      title={subject}
    >
      <span ref={text} className="block w-max">
        {subject}
      </span>
      {clipped && (
        <span aria-hidden="true" className="overflow-fade absolute inset-y-0 end-0 w-5" />
      )}
    </span>
  );
});
