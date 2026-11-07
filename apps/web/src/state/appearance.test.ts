import test from 'node:test';
import assert from 'node:assert/strict';
import { editorTheme, parseAppearance, resolveAppearance } from './appearance';

test('appearance validates saved preferences and resolves independent light and dark themes', () => {
  const defaults = { colorScheme: 'system', lightTheme: 'monaco', darkTheme: 'monaco' };
  for (const value of [
    null,
    undefined,
    'invalid',
    1,
    {},
    { colorScheme: 'unknown', lightTheme: {}, darkTheme: 'missing' },
  ]) {
    assert.deepEqual(parseAppearance(value), defaults);
  }
  const appearance = parseAppearance({
    colorScheme: 'system',
    lightTheme: 'monaco',
    darkTheme: 'darcula',
  });
  assert.deepEqual(resolveAppearance(appearance, false), { scheme: 'light', theme: 'monaco' });
  assert.deepEqual(resolveAppearance(appearance, true), { scheme: 'dark', theme: 'darcula' });
  for (const systemDark of [false, true]) {
    assert.equal(editorTheme({ ...appearance, colorScheme: 'light' }, systemDark), 'vs');
    assert.equal(editorTheme({ ...appearance, colorScheme: 'dark' }, systemDark), 'darcula-dark');
    assert.equal(
      editorTheme({ ...appearance, colorScheme: 'light', lightTheme: 'darcula' }, systemDark),
      'darcula-light',
    );
    assert.equal(
      editorTheme({ ...appearance, colorScheme: 'dark', darkTheme: 'monaco' }, systemDark),
      'vs-dark',
    );
  }
});
