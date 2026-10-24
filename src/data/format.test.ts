import assert from 'node:assert/strict';
import { test } from 'node:test';
import { day, dayMonth, fullDay, initials, month, monthYear } from './format';

test('monthYear marks the elided year, for a month or a day', () => {
  assert.equal(monthYear('2026-09'), 'Sep ’26');
  assert.equal(monthYear('2023-11-30'), 'Nov ’23');
  assert.equal(monthYear('2026-10-22'), 'Oct ’26');
});

test('day formats read the date in UTC and never write "Sept"', () => {
  assert.equal(dayMonth('2026-09-01'), '1 Sep');
  assert.equal(day('2026-09-30'), '30 Sep 2026');
  assert.equal(month('2026-09'), 'September 2026');
  assert.equal(fullDay('2026-09-01'), '1 September 2026');
});

test('initials take two words, or two letters of one, and skip punctuation', () => {
  assert.equal(initials('search (driceroland)'), 'sd');
  assert.equal(initials('Rolls-Royce'), 'rr');
  assert.equal(initials('UCLA'), 'uc');
});
