import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { graphql } from '../../src/data/contributions';
import { load } from './contributions';

const token = 'github_pat_test-token';
const original = {
  fetch: globalThis.fetch,
  warn: console.warn,
  timeout: AbortSignal.timeout,
  now: Date.now,
};
const day = 86_400_000;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];

// The dates from `from` to `to`, both included, as YYYY-MM-DD.
const dates = (from: string, to: string) =>
  Array.from({ length: (Date.parse(to) - Date.parse(from)) / day + 1 }, (_, i) =>
    date(Date.parse(from) + i * day),
  );
// A count that differs from day to day, so a misplaced day shows.
const byDate = (when: string) => Number(when.slice(8)) * 3;

// One contributionsCollection as GitHub answers it, in weeks of up to seven days, with fields the
// source never asks for, repository names included, which it must not pass on.
const range = (days: string[], count: (when: string) => number = byDate) => ({
  totalContributions: 1,
  commitContributionsByRepository: [{ repository: { name: 'secret-client-work' } }],
  contributionCalendar: {
    isHalloween: false,
    weeks: Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => ({
      firstDay: days[w * 7],
      contributionDays: days.slice(w * 7, w * 7 + 7).map((when) => ({
        date: when,
        contributionCount: count(when),
        contributionLevel: 'NONE',
        color: '#ebedf0',
        weekday: new Date(when).getUTCDay(),
        repository: { name: 'secret-client-work' },
      })),
    })),
  },
});

// The request's own ranges, as dates: head is a to b, tail c to d.
const variables = (init?: RequestInit) => {
  const { a, b, c, d } = JSON.parse(String(init?.body)).variables;
  return {
    head: dates(a.slice(0, 10), b.slice(0, 10)),
    tail: dates(c.slice(0, 10), d.slice(0, 10)),
  };
};

// The calendar GitHub would send for the request's ranges, `edit` changing its days first.
const calendar =
  (edit: (ranges: { head: string[]; tail: string[] }) => void = () => {}, count = byDate) =>
  (init?: RequestInit) => {
    const ranges = variables(init);
    edit(ranges);
    return Response.json({
      data: { user: { head: range(ranges.head, count), tail: range(ranges.tail, count) } },
    });
  };

function github(answer: (init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return answer(init);
  };
}

// The value load should give for a request at `now`: every window day, from `first`, by date.
const expected = (now: string, first: string) => {
  const end = date(Date.parse(now));
  return { end, days: dates(first, end).map(byDate) };
};

beforeEach(() => {
  requests = [];
  warnings = [];
  console.warn = (message: string) => warnings.push(message);
  Date.now = () => Date.parse('2026-11-04T12:00:00Z');
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  console.warn = original.warn;
  AbortSignal.timeout = original.timeout;
  Date.now = original.now;
});

test('loads one count per window day, oldest first, and nothing else', async () => {
  github(calendar());
  const value = await load(token);
  assert.deepEqual(value, expected('2026-11-04T12:00:00Z', '2025-11-02'));
  assert.equal(value?.days.length, 368);
  assert.doesNotMatch(JSON.stringify(value), /secret|repository|NONE|#ebedf0/);
  assert.deepEqual(warnings, []);
});

test('asks GitHub once, with the token, within one 3 s signal', async () => {
  const signals: AbortSignal[] = [];
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    const signal = original.timeout.call(AbortSignal, ms);
    signals.push(signal);
    return signal;
  };
  github(calendar());
  await load(token);
  assert.deepEqual(budgets, [3_000]);
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url, graphql);
  assert.equal(init?.method, 'POST');
  assert.equal(init?.signal, signals[0]);
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
});

test('days GitHub adds outside the window are dropped', async () => {
  github(
    calendar(({ head, tail }) => {
      head.unshift('2025-10-30', '2025-10-31', '2025-11-01');
      tail.push('2026-11-05', '2026-11-06');
    }),
  );
  assert.deepEqual(await load(token), expected('2026-11-04T12:00:00Z', '2025-11-02'));
});

test('a window with no activity is a value', async () => {
  github(calendar(undefined, () => 0));
  assert.deepEqual(await load(token), {
    end: '2026-11-04',
    days: Array<number>(368).fill(0),
  });
});

test('the window follows the day: Sunday rollover, a new year, a leap day', async () => {
  github(calendar());
  const cases: [string, string, number][] = [
    ['2026-11-07T23:59:59.999Z', '2025-11-02', 371],
    ['2026-11-08T00:00:00Z', '2025-11-09', 365],
    ['2027-01-01T00:00:00Z', '2025-12-28', 370],
    ['2028-02-29T08:00:00Z', '2027-02-28', 367],
  ];
  for (const [now, first, length] of cases) {
    Date.now = () => Date.parse(now);
    const value = await load(token);
    assert.deepEqual(value, expected(now, first), now);
    assert.equal(value?.days.length, length, now);
  }
  assert.ok(requests.some(({ init }) => variables(init).tail.includes('2028-02-29')));
});

test('a missing token is no value, and GitHub is not asked', async () => {
  for (const missing of [undefined, '']) {
    assert.equal(await load(missing), null);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(warnings, [
    'contributions: no value from GitHub (no CONTRIBUTIONS_TOKEN)',
    'contributions: no value from GitHub (no CONTRIBUTIONS_TOKEN)',
  ]);
});

test('an error status, GraphQL errors, a bad or oversized body are no value', async () => {
  const big = `{"data":${JSON.stringify('x'.repeat(70_000))}}`;
  const cases: [(init?: RequestInit) => Response | Promise<Response>, string][] = [
    [() => new Response('no', { status: 401 }), 'HTTP 401'],
    [() => new Response('no', { status: 403 }), 'HTTP 403'],
    [() => new Response('no', { status: 502 }), 'HTTP 502'],
    [
      () => Response.json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit' }] }),
      'GraphQL RATE_LIMITED',
    ],
    // Errors beside a whole calendar still fail it.
    [
      async (init) => {
        const { data } = await calendar()(init).json();
        return Response.json({ data, errors: [{ type: 'NOT_FOUND', message: 'x' }] });
      },
      'GraphQL NOT_FOUND',
    ],
    [
      () => Response.json({ data: { user: null }, errors: [{ message: 'no user' }] }),
      'GraphQL errors',
    ],
    // Only an upper-case word is logged, never free text.
    [() => Response.json({ errors: [{ type: 'rate limited', message: 'x' }] }), 'GraphQL errors'],
    [() => new Response('{'), 'SyntaxError'],
    [() => new Response(big), 'RangeError'],
    [() => new Response(big, { headers: { 'Content-Length': String(big.length) } }), 'RangeError'],
    [
      () => {
        throw new TypeError(`network down, ${token}`);
      },
      'TypeError',
    ],
    [
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      'TimeoutError',
    ],
  ];
  for (const [answer, reason] of cases) {
    github(answer);
    assert.equal(await load(token), null, reason);
    assert.equal(warnings.at(-1), `contributions: no value from GitHub (${reason})`);
  }
  assert.equal(warnings.length, cases.length);
  assert.doesNotMatch(warnings.join('\n'), new RegExp(token));
});

test('a calendar that is not whole or not well formed is no value', async () => {
  const edits: [string, (ranges: { head: string[]; tail: string[] }) => void][] = [
    ['a short head', ({ head }) => head.pop()],
    ['a missing day', ({ tail }) => tail.splice(100, 1)],
    ['a missing end', ({ tail }) => tail.pop()],
    ['a day in both ranges', ({ head, tail }) => tail.unshift(head[6])],
    ['a repeated day', ({ tail }) => tail.splice(50, 0, tail[50])],
  ];
  for (const [name, edit] of edits) {
    github(calendar(edit));
    assert.equal(await load(token), null, name);
  }
  const head = range(dates('2025-11-02', '2025-11-08'));
  // A whole window, with `skip` left out of it and the days in `extra` added to it, so a bad day
  // fails the window on its own, not by leaving a window day missing.
  const withDays = (extra: unknown[], skip?: string) => ({
    data: {
      user: {
        head,
        tail: {
          contributionCalendar: {
            weeks: [
              { contributionDays: extra },
              ...range(dates('2025-11-09', '2026-11-04').filter((when) => when !== skip))
                .contributionCalendar.weeks,
            ],
          },
        },
      },
    },
  });
  // The window with its day 2025-11-09 replaced by `entry`.
  const inPlace = (entry: object) => withDays([{ date: '2025-11-09', ...entry }], '2025-11-09');
  for (const body of [withDays([]), inPlace({ contributionCount: 0 })]) {
    github(() => Response.json(body));
    assert.equal((await load(token))?.days.length, 368);
  }
  const bodies: [string, unknown][] = [
    ['no data', {}],
    ['no user', { data: { user: null } }],
    ['a user that is not an object', { data: { user: 'vedaant-rajoo' } }],
    ['no tail', { data: { user: { head } } }],
    ['weeks not an array', { data: { user: { head: { contributionCalendar: { weeks: {} } } } } }],
    [
      'contributionDays not an array',
      { data: { user: { head: { contributionCalendar: { weeks: [{}] } }, tail: head } } },
    ],
    // Beside a whole window: dates that are not real days.
    ['an impossible month', withDays([{ date: '2025-13-09', contributionCount: 0 }])],
    // Some engines read these as 2025-03-02 (outside the window) and 2026-03-01 (inside it).
    ['an impossible day', withDays([{ date: '2025-02-30', contributionCount: 0 }])],
    ['a leap day in 2026', withDays([{ date: '2026-02-29', contributionCount: 0 }], '2026-03-01')],
    ['an unpadded day', withDays([{ date: '2025-11-9', contributionCount: 0 }])],
    ['a missing date', withDays([{ contributionCount: 0 }])],
    ['a null day', withDays([null])],
    // In place of a window day: counts that are not non-negative integers.
    ['a negative count', inPlace({ contributionCount: -2 })],
    ['a fractional count', inPlace({ contributionCount: 1.5 })],
    ['a string count', inPlace({ contributionCount: '3' })],
    ['a missing count', inPlace({})],
  ];
  for (const [name, body] of bodies) {
    github(() => Response.json(body));
    assert.equal(await load(token), null, name);
  }
  assert.deepEqual(
    warnings,
    Array(edits.length + bodies.length).fill(
      'contributions: no value from GitHub (unexpected body)',
    ),
  );
});
