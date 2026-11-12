import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { desktop } from './desktop';

function setWindow(t: TestContext, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  });
}

test('text copy uses the desktop bridge when browser clipboard permission is denied', async (t) => {
  const denied = new DOMException(
    "Failed to execute 'writeText' on 'Clipboard': Write permission denied.",
    'NotAllowedError',
  );
  t.mock.getter(globalThis, 'navigator', () => ({
    clipboard: {
      writeText: async () => {
        throw denied;
      },
    },
  }));
  const copied: string[] = [];
  setWindow(t, {
    superfluid: {
      copyText: async (text: string) => {
        copied.push(text);
      },
    },
  });
  await desktop.copyText('models.Store.count');
  await desktop.copyText('');
  assert.deepEqual(copied, ['models.Store.count', '']);
});

test('text copy preserves browser writes and propagates browser and desktop failures', async (t) => {
  const copied: string[] = [];
  const denied = new DOMException('Write permission denied.', 'NotAllowedError');
  setWindow(t, {});
  t.mock.getter(globalThis, 'navigator', () => ({
    clipboard: {
      writeText: async (text: string) => {
        copied.push(text);
      },
    },
  }));
  await desktop.copyText('web text');
  assert.deepEqual(copied, ['web text']);
  t.mock.getter(globalThis, 'navigator', () => ({
    clipboard: {
      writeText: async () => {
        throw denied;
      },
    },
  }));
  await assert.rejects(desktop.copyText('denied'), (error) => error === denied);
  t.mock.getter(globalThis, 'navigator', () => ({
    clipboard: {
      writeText: async (text: string) => {
        copied.push(text);
      },
    },
  }));
  Object.defineProperty(globalThis, 'window', {
    value: {
      superfluid: {
        copyText: async () => {
          throw denied;
        },
      },
    },
  });
  await assert.rejects(desktop.copyText('desktop denied'), (error) => error === denied);
  assert.deepEqual(copied, ['web text']);
});
