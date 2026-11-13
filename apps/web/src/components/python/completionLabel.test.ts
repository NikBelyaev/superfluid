import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionLabel } from './completionLabel';

test('completion labels keep server signatures separate from the inserted name', () => {
  for (const [label, detail, suffix] of [
    ['count', 'bound method Store.count() -> int', '() -> int'],
    ['find_product', 'bound method Store.find_product(name: str) -> str', '(name: str) -> str'],
    ['__new__', 'def __new__[Self](cls) -> Self', '[Self](cls) -> Self'],
    ['name', 'str', ': str'],
    ['products', 'list[Product]', ': list[Product]'],
    ['find', '(name: str, /) -> str', '(name: str, /) -> str'],
    ['value', undefined, undefined],
    ['Store', 'class Store', undefined],
  ]) {
    assert.deepEqual(completionLabel({ label: label!, detail }), {
      label,
      ...(suffix ? { detail: suffix } : {}),
    });
  }
  assert.deepEqual(
    completionLabel({ label: 'find', detail: 'unresolved', labelDetails: { detail: '(name)' } }),
    { label: 'find', detail: '(name)' },
  );
  assert.deepEqual(completionLabel({ label: 'WorkLevel', detail: "<class 'WorkLevel'>" }), {
    label: 'WorkLevel',
  });
  assert.deepEqual(
    completionLabel({ label: 'work_order_json_ui', detail: "<module 'apps.work_order_json_ui'>" }),
    {
      label: 'work_order_json_ui',
      description: 'apps.work_order_json_ui',
    },
  );
  assert.deepEqual(completionLabel({ label: 'Store', labelDetails: { description: 'models' } }), {
    label: 'Store',
    description: 'models',
  });
  assert.deepEqual(
    completionLabel({
      label: 'Store',
      labelDetails: { detail: '(import models)' },
      additionalTextEdits: [{ newText: 'from models import Store\n\n' }],
    }),
    { label: 'Store', description: 'models' },
  );
  assert.deepEqual(
    completionLabel({
      label: 'count',
      detail: 'bound method Store.count() -> int',
      labelDetails: { description: 'bound method Store.count() -> int' },
    }),
    { label: 'count', detail: '() -> int' },
  );
});
