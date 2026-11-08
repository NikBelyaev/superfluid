import { desktop } from '~/rpc/desktop';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ExternalLink, Globe } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import { useDndContext } from '@dnd-kit/core';

export function Browser({ url }: { url: string }) {
  const { active: dragging } = useDndContext();
  const host = useRef<HTMLDivElement>(null),
    overlayOpen = useApp((a) => !!a.modal || !!a.palette || !!a.surfaceMenu),
    [address, setAddress] = useState(url),
    [error, setError] = useState('');
  const overlay = overlayOpen || !!dragging;
  useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (!host.current) return;
      const r = host.current.getBoundingClientRect();
      void desktop
        .browser({
          visible: !overlay,
          bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    };
    const obs = new ResizeObserver(update);
    if (host.current) obs.observe(host.current);
    update();
    return () => {
      cancelled = true;
      obs.disconnect();
      void desktop.browser({ visible: false });
    };
  }, [overlay]);
  useEffect(() => {
    setError('');
    void desktop.browser({ visible: !overlay, url }).catch((e) => setError(e.message));
    return () => {
      void desktop.browser({ visible: false });
    };
  }, [url]);
  return (
    <div className="surface-content">
      <form
        className="browser-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          void desktop.browser({ visible: true, url: address }).catch((e) => setError(e.message));
        }}
      >
        <Globe size={14} />
        <input
          aria-label="Preview URL"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="icon-button" title="Load URL">
          <ArrowUpRight size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Open in browser"
          onClick={() => void desktop.external(address).catch(useApp.getState().fail)}
        >
          <ExternalLink size={14} />
        </button>
      </form>
      {error && <div className="inline-error">{error}</div>}
      <div className="browser-viewport" ref={host} />
    </div>
  );
}
