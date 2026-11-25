import test from 'node:test';
import assert from 'node:assert/strict';
import { fitChips } from './OverflowChips';

test('chips fit their measured width and reserve room for the exact overflow count', () => {
  const widths = [20, 15, 10];
  assert.equal(fitChips(widths, [18], 4, 53).visible, 3);
  assert.equal(fitChips(widths, [18], 4, 52).visible, 1);
  assert.equal(fitChips(widths, [18], 4, 41).visible, 0);
  assert.equal(fitChips(Array(11).fill(20), [18, 28], 4, 66).visible, 2);
  assert.equal(fitChips(Array(11).fill(20), [18, 28], 4, 51).visible, 0);
});

test('overlapping chips count only once they are less than 40% visible', () => {
  const widths = [50, 60, 40];
  assert.deepEqual(fitChips(widths, [22], 4, 100, true), {
    visible: 2,
    hidden: 1,
    badgeWidth: 22,
    showPartial: true,
  });
  assert.deepEqual(fitChips(widths, [22], 4, 99, true), {
    visible: 1,
    hidden: 2,
    badgeWidth: 22,
    showPartial: false,
  });
  assert.deepEqual(fitChips(widths, [22], 4, 100), {
    visible: 1,
    hidden: 2,
    badgeWidth: 22,
    showPartial: false,
  });
  assert.deepEqual(fitChips(widths, [22], 4, 134, true), {
    visible: 3,
    hidden: 0,
    badgeWidth: 0,
    showPartial: true,
  });
  assert.equal(fitChips(widths, [22], 4, 133, true).hidden, 1);
});
