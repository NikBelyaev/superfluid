import { desktop } from '~/rpc/desktop';
import { useEffect, useRef } from 'react';
import {
  renderGhosttySnapshot,
  measureGhosttyCell,
  terminalGridSize,
} from '@superfluid/ghostty/renderer';
import type { GhosttySnapshot } from '@superfluid/ghostty/core';
import { useApp } from '~/state/workspaceStore';
import { resolveAppearance, useAppearance, useSystemDark } from '~/state/appearance';

export default function Terminal({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    snapshot = useRef<GhosttySnapshot | null>(null);
  const output = useRef<HTMLPreElement>(null);
  const { scheme } = resolveAppearance(useAppearance(), useSystemDark());
  useEffect(() => {
    const c = canvas.current!,
      element = host.current!,
      context = c.getContext('2d')!;
    let raf = 0,
      sequence = 0,
      chunk = 0,
      disposed = false,
      selection: { x: number; y: number } | null = null;
    const appearance = getComputedStyle(document.documentElement),
      font = appearance.getPropertyValue('--font-mono').trim(),
      fontSize = parseFloat(appearance.getPropertyValue('--font-size-code')),
      metrics = measureGhosttyCell(context, fontSize, font);
    const call = (command: any, data?: unknown) =>
      desktop.call('terminal.command', { id, command, data }).catch(useApp.getState().fail);
    const draw = () => {
      raf = 0;
      const s = snapshot.current;
      if (!s || disposed) return;
      const dpr = window.devicePixelRatio;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderGhosttySnapshot({
        context,
        snapshot: s,
        metrics,
        fontSize,
        fontFamily: font,
        padding: 12,
        forceFull: true,
        cursorOn: true,
        focused: document.activeElement === input.current,
      });
      if (output.current)
        output.current.textContent = s.rowData.map((r) => r?.text ?? '').join('\n');
      void call('ack', { sequence, chunk });
    };
    const unsubscribe = desktop.onEvent((e) => {
      if (e.type !== 'terminal.frame' || e.frame.id !== id) return;
      const f = e.frame;
      if (f.sequence < sequence) return;
      sequence = f.sequence;
      chunk = f.chunk;
      const previous = snapshot.current;
      const rows = f.full || !previous ? [] : [...previous.rowData];
      for (const [n, row] of f.rows) rows[n] = row;
      snapshot.current = { ...f.header, rowData: rows, dirtyRows: new Set(f.rows.map(([n]) => n)) };
      if (f.last && !raf) raf = requestAnimationFrame(draw);
      else if (!f.last) void call('ack', { sequence, chunk });
    });
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect(),
        dpr = window.devicePixelRatio;
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
      const grid = terminalGridSize(rect.width, rect.height, metrics, 12);
      void call('resize', {
        cols: Math.min(400, grid.cols),
        rows: Math.min(120, grid.rows),
        cellWidth: metrics.width,
        cellHeight: metrics.height,
      });
    });
    observer.observe(element);
    void call('attach');
    input.current?.focus();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      void call('scroll', Math.round(e.deltaY / metrics.height));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const point = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor((e.clientX - r.left - 12) / metrics.width)),
        y: Math.max(0, Math.floor((e.clientY - r.top - 12) / metrics.height)),
      };
    };
    const down = (e: PointerEvent) => {
      selection = point(e);
      c.setPointerCapture(e.pointerId);
      input.current?.focus();
    };
    const move = (e: PointerEvent) => {
      if (selection) void call('select', { start: selection, end: point(e) });
    };
    const up = () => {
      selection = null;
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    return () => {
      disposed = true;
      unsubscribe();
      observer.disconnect();
      cancelAnimationFrame(raf);
      element.removeEventListener('wheel', wheel);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      void call('detach');
      snapshot.current = null;
    };
  }, [id]);
  useEffect(() => {
    const appearance = getComputedStyle(document.documentElement);
    const color = (value: string) => {
      const [r, g, b] = value.match(/[\d.]+/g)!.map(Number);
      return { r, g, b };
    };
    void desktop
      .call('terminal.command', {
        id,
        command: 'theme',
        data: {
          foreground: color(appearance.color),
          background: color(appearance.backgroundColor),
          cursor: color(appearance.color),
        },
      })
      .catch(useApp.getState().fail);
  }, [id, scheme]);
  const send = (command: any, data: unknown) =>
    void desktop.call('terminal.command', { id, command, data }).catch(useApp.getState().fail);
  return (
    <div ref={host} className="terminal-host">
      <canvas ref={canvas} aria-hidden="true" />
      <textarea
        ref={input}
        aria-label="Terminal input"
        className="terminal-input"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onCompositionEnd={(e) => {
          send('text', e.data);
          e.currentTarget.value = '';
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.key === 'Dead' || e.key === 'Process') return;
          if ((e.metaKey || e.ctrlKey) && e.key === 'c' && e.metaKey) {
            e.preventDefault();
            void desktop
              .call('terminal.command', { id, command: 'copy' })
              .then((value) => {
                if (value) return desktop.copyText(value);
              })
              .catch(useApp.getState().fail);
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'v') return;
          if (e.metaKey) return;
          e.preventDefault();
          send('key', {
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            repeat: e.repeat,
            capsLock: e.getModifierState('CapsLock'),
            numLock: e.getModifierState('NumLock'),
          });
        }}
        onPaste={(e) => {
          e.preventDefault();
          send('text', e.clipboardData.getData('text'));
        }}
        onInput={(e) => {
          const data = e.currentTarget.value;
          if (data) {
            send('text', data);
            e.currentTarget.value = '';
          }
        }}
      />
      <pre ref={output} className="sr-only" aria-label="Terminal output" />
    </div>
  );
}
