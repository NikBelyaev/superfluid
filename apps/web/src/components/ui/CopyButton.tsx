import { useEffect, useRef, useState } from 'react';
import { Tooltip } from './Tooltip';
import { desktop } from '~/rpc/desktop';
import './copyButton.css';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [feedback, setFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      request.current++;
      clearTimeout(timer.current);
    },
    [],
  );
  const message =
    feedback === 'copied' ? 'Copied' : feedback === 'failed' ? 'Could not copy' : label;
  return (
    <>
      <Tooltip content={message}>
        <button
          type="button"
          className="copy-button"
          aria-label={message}
          aria-busy={pending}
          disabled={pending}
          data-feedback={feedback}
          onClick={async () => {
            const id = ++request.current;
            clearTimeout(timer.current);
            setPending(true);
            let copied = false;
            try {
              await desktop.copyText(value);
              copied = true;
            } catch {}
            if (id !== request.current) return;
            setPending(false);
            setFeedback(copied ? 'copied' : 'failed');
            timer.current = setTimeout(() => setFeedback('idle'), 1800);
          }}
        >
          <span className="copy-button-glyph" aria-hidden>
            <span className="copy-button-back" />
            <span className="copy-button-front" />
          </span>
        </button>
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">
        {feedback !== 'idle' ? `${label}: ${message}` : ''}
      </span>
    </>
  );
}
