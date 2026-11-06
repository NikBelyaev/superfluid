import test from 'node:test';
import assert from 'node:assert/strict';
import { GhosttyTerminalCore } from '@superfluid/ghostty/core';
import { loadGhosttyRuntime } from '@superfluid/ghostty/runtime';


test('Ghostty retains alternate screen and modes without replaying old PTY queries', async () => {
  const replies: string[] = [];
  const core = await GhosttyTerminalCore.create(
    80,
    24,
    8,
    18,
    {
      foreground: { r: 0, g: 0, b: 0 },
      background: { r: 255, g: 255, b: 255 },
      cursor: { r: 0, g: 0, b: 0 },
    },
    (s) => replies.push(s),
  );
  try {
    core.write('normal\r\n'.repeat(6000));
    core.write('\x1b[?1049h\x1b[?1h\x1b[2J\x1b[Halternate screen');
    assert.equal(core.isAlternateScreen(), true);
    assert.equal(core.isApplicationCursorKeys(), true);
    assert.match(core.snapshot().rowData[0].text, /alternate screen/);
    core.write('\x1b[6n');
    const n = replies.length;
    for (let i = 0; i < 10; i++) core.snapshot();
    assert.equal(replies.length, n);
    assert.equal(core.isAlternateScreen(), true);
  } finally {
    core.dispose();
  }
});


test('twelve terminal parsers keep bounded scrollback memory under sustained output', async () => {
  const runtime = await loadGhosttyRuntime(),
    cores: GhosttyTerminalCore[] = [];
  const theme = {
    foreground: { r: 0, g: 0, b: 0 },
    background: { r: 255, g: 255, b: 255 },
    cursor: { r: 0, g: 0, b: 0 },
  };
  try {
    for (let i = 0; i < 12; i++) {
      const core = await GhosttyTerminalCore.create(180, 45, 8, 18, theme, () => {});
      cores.push(core);
      core.write(('x'.repeat(170) + '\r\n').repeat(8000));
    }
    const before = runtime.memory.buffer.byteLength;
    assert.ok(before < 128 * 1024 * 1024);
    cores[0].write(('y'.repeat(170) + '\r\n').repeat(80000));
    assert.ok(runtime.memory.buffer.byteLength - before <= 16 * 1024 * 1024);
    const warmed = runtime.memory.buffer.byteLength;
    cores[0].write(('z'.repeat(170) + '\r\n').repeat(80000));
    assert.equal(runtime.memory.buffer.byteLength, warmed);
  } finally {
    for (const core of cores) core.dispose();
  }
});
