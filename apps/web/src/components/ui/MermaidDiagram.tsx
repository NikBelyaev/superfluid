import { memo, useEffect, useRef, useState } from 'react';
import { CodeXml, Workflow } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { CopyButton } from './CopyButton';
import { escapeSequenceMessageSemicolons } from './mermaidSource';
import './mermaidDiagram.css';

export const MermaidDiagram = memo(function MermaidDiagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = useState(false);
  const [result, setResult] = useState<{ source: string; error?: string } | null>(null);
  useEffect(() => {
    const container = host.current;
    if (!container || showSource) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    void (async () => {
      const [pele, { default: purifier }] = await Promise.all([
        import('pele/lazy'),
        import('dompurify'),
      ]);
      await pele.load(pele.detectType(source));
      if (cancelled) return;
      let text = source;
      try {
        pele.parse(text);
      } catch (error) {
        text = escapeSequenceMessageSemicolons(source);
        if (text === source) throw error;
        pele.parse(text);
      }
      const mounted = pele.mount(container, text, {
        links: false,
        images: false,
        zoom: false,
        autoDirection: false,
        sanitize: (svg) => {
          const fragment = purifier.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['a', 'image', 'foreignObject', 'style'],
            FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
            RETURN_DOM_FRAGMENT: true,
          });
          const diagram = fragment.querySelector('svg');
          diagram?.setAttribute('role', 'img');
          if (diagram && !diagram.hasAttribute('aria-labelledby'))
            diagram.setAttribute('aria-label', 'Mermaid diagram');
          return fragment;
        },
        onRender: () => {
          if (!cancelled) setResult({ source });
        },
        onError: (error) => {
          if (!cancelled) setResult({ source, error: String(error) });
        },
      });
      destroy = () => mounted.destroy();
    })().catch((error: unknown) => {
      if (!cancelled)
        setResult({ source, error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
      destroy?.();
      container.replaceChildren();
    };
  }, [source, showSource]);
  const current = result?.source === source ? result : null;
  const Icon = showSource ? Workflow : CodeXml;
  return (
    <div className="mermaid-diagram">
      <div className="mermaid-toolbar">
        <span>mermaid</span>
        <div className="mermaid-actions">
          {showSource && <CopyButton value={source} label="Copy Mermaid source" />}
          <Tooltip content={showSource ? 'Show diagram' : 'Show diagram source'} side="bottom">
            <button
              className="icon-button"
              aria-label="Toggle Mermaid source"
              aria-pressed={showSource}
              onClick={() => setShowSource(!showSource)}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
      {showSource ? (
        <pre className="mermaid-source" aria-label="Mermaid source" tabIndex={0}>
          <code>{source}</code>
        </pre>
      ) : (
        <>
          {!current && <div role="status">Rendering diagram…</div>}
          {current?.error && (
            <div role="status">Unable to render Mermaid diagram: {current.error}</div>
          )}
          <div className="mermaid-host" ref={host} />
          {current?.error && (
            <pre>
              <code>{source}</code>
            </pre>
          )}
        </>
      )}
    </div>
  );
});
