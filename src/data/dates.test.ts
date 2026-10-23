import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthYear } from './dates';

test('monthYear marks the elided year, for a month or a day', () => {
  assert.equal(monthYear('2026-09'), 'Sep ’26');
  assert.equal(monthYear('2023-11-30'), 'Nov ’23');
  assert.equal(monthYear('2026-10-22'), 'Oct ’26');
});
