import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cells,
  contributionsFromLive,
  contributionsRequest,
  contributionsText,
  graphql,
  level,
  span,
} from './contributions';
import snapshot from './snapshots/contributions.json';

test('span: 53 week columns from a Sunday, ending on the UTC day', () => {
  const rows: [string, string, string, number][] = [
    ['2026-11-04T12:00:00Z', '2025-11-02', '2026-11-04', 368],
    // Saturday's last moment, then Sunday: a week leaves on the left, a one-day column starts.
    ['2026-11-07T23:59:59.999Z', '2025-11-02', '2026-11-07', 371],
    ['2026-11-08T00:00:00Z', '2025-11-09', '2026-11-08', 365],
    ['2026-12-31T23:59:59Z', '2025-12-28', '2026-12-31', 369],
    ['2027-01-01T00:00:00Z', '2025-12-28', '2027-01-01', 370],
    ['2028-02-29T08:00:00Z', '2027-02-28', '2028-02-29', 367],
    ['2028-03-01T00:00:00Z', '2027-02-28', '2028-03-01', 368],
  ];
  for (const [now, start, end, length] of rows) {
    assert.deepEqual(span(Date.parse(now)), { start, end, length }, now);
    assert.equal(new Date(start).getUTCDay(), 0, now);
  }
});

test('contributionsRequest: one POST of two ranges for the linked profile, three headers', () => {
  const signal = AbortSignal.timeout(1_000);
  const init = contributionsRequest('gh-token', Date.parse('2026-11-04T12:00:00.250Z'), signal);
  assert.equal(graphql, 'https://api.github.com/graphql');
  assert.equal(init.method, 'POST');
  assert.equal(init.signal, signal);
  assert.deepEqual(init.headers, {
    Authorization: 'Bearer gh-token',
    'Content-Type': 'application/json',
    'User-Agent': 'vedaantrajoo.com',
  });
  assert.deepEqual(Object.keys(init), ['method', 'headers', 'body', 'signal']);
  // The approved query, written out: two aliased ranges, bound to the first week and the rest, each
  // asking only for a day's date and count. The variables run up to the request, without
  // milliseconds.
  assert.deepEqual(JSON.parse(init.body), {
    query: `query ($login: String!, $a: DateTime!, $b: DateTime!, $c: DateTime!, $d: DateTime!) {
  user(login: $login) {
    head: contributionsCollection(from: $a, to: $b) { ...days }
    tail: contributionsCollection(from: $c, to: $d) { ...days }
  }
}
fragment days on ContributionsCollection {
  contributionCalendar { weeks { contributionDays { date contributionCount } } }
}`,
    variables: {
      login: 'vedaant-rajoo',
      a: '2025-11-02T00:00:00Z',
      b: '2025-11-08T23:59:59Z',
      c: '2025-11-09T00:00:00Z',
      d: '2026-11-04T12:00:00Z',
    },
  });
});

test('the committed snapshot is a whole window ending on its day', () => {
  assert.deepEqual(Object.keys(snapshot), ['end', 'days']);
  const end = Date.parse(snapshot.end);
  assert.match(snapshot.end, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(end).toISOString().slice(0, 10), snapshot.end);
  assert.equal(snapshot.days.length, span(end).length);
  for (const count of snapshot.days) {
    assert.ok(Number.isSafeInteger(count) && count >= 0, String(count));
  }
});

test('level: a quarter of the busiest day each, the next level up, as the profile draws it', () => {
  assert.deepEqual(
    [0, 1, 11, 12, 22, 23, 33, 34, 44].map((count) => level(count, 44)),
    [0, 1, 1, 2, 2, 3, 3, 4, 4],
  );
  assert.equal(level(0, 0), 0);
});

test('cells: 371 slots from the first Sunday, titled, blank after end', () => {
  // Wednesday 2026-11-04: 368 days, so three blank slots close the last column.
  const days = Array<number>(368).fill(0);
  days[1] = 1;
  days[100] = 400;
  days[367] = 1204;
  const slots = cells({ end: '2026-11-04', days });
  assert.equal(slots.length, 371);
  assert.deepEqual(slots[0], { level: 0, title: 'no contributions on 2 Nov 2025' });
  assert.deepEqual(slots[1], { level: 1, title: '1 contribution on 3 Nov 2025' });
  // A quarter of the busiest day (1,204), not of the window's total, so 400 is level 2.
  assert.deepEqual(slots[100], { level: 2, title: '400 contributions on 10 Feb 2026' });
  assert.deepEqual(slots[367], { level: 4, title: '1,204 contributions on 4 Nov 2026' });
  assert.deepEqual(slots.slice(368), [null, null, null]);
});

test('contributionsText: the total since the first Sunday, or no public activity', () => {
  assert.deepEqual(contributionsText({ end: '2026-11-04', days: [...Array(367).fill(0), 2] }), {
    total: '2 contributions',
    since: 'since 2 Nov 2025',
    updated: 'updated 4 Nov 2026',
    date: '2026-11-04',
  });
  assert.equal(
    contributionsText({ end: '2026-11-08', days: Array(365).fill(0) }).total,
    'no public activity',
  );
  assert.equal(
    contributionsText({ end: '2026-11-08', days: Array(365).fill(0) }).since,
    'since 9 Nov 2025',
  );
  assert.equal(contributionsText(snapshot).total, '615 contributions');
});

test('contributionsFromLive: a whole window ending on a real day, or null', () => {
  const live = (contributions: unknown) => contributionsFromLive({ coding: null, contributions });
  assert.deepEqual(live(snapshot), snapshot);
  // Sunday 2026-11-08 starts a column, so 365 days; a Saturday closes one, 371.
  assert.deepEqual(live({ end: '2026-11-08', days: Array(365).fill(0) })?.days.length, 365);
  assert.deepEqual(live({ end: '2026-11-07', days: Array(371).fill(2) })?.days.length, 371);
  // Anything the hub would trust wrongly; a value that would throw on coercion is refused, not
  // thrown, so the answer's other parts still update.
  const days = snapshot.days;
  for (const value of [
    undefined,
    null,
    'x',
    { end: snapshot.end },
    { end: snapshot.end, days: days.slice(1) },
    { end: snapshot.end, days: [...days, 0] },
    { end: '2026-11-05', days },
    { end: '2026-02-30', days: Array(366).fill(0) },
    { end: '2026-11-04T00:00:00Z', days },
    { end: { toString: null }, days },
    { end: 20261104, days },
    { end: snapshot.end, days: days.map((count, i) => (i ? count : -1)) },
    { end: snapshot.end, days: days.map((count, i) => (i ? count : 1.5)) },
    { end: snapshot.end, days: days.map((count, i) => (i ? count : '1')) },
    { end: snapshot.end, days: days.map((count, i) => (i ? count : 2 ** 53)) },
  ]) {
    assert.equal(live(value), null, JSON.stringify(value));
  }
  assert.equal(contributionsFromLive(null), null);
  // Only end and days are passed on.
  assert.deepEqual(Object.keys(live({ ...snapshot, total: 615 }) ?? {}), ['end', 'days']);
});
