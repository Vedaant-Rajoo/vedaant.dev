import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contributionsRequest, graphql, span } from './contributions';
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
