import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { currentUser, lastMonth, lastWeek } from '../../src/data/coding';
import site from '../../src/data/site.json';
import { load } from './coding';

const key = 'waka-test-token';
const summaries = lastWeek(site.timeZone);
const original = { fetch: globalThis.fetch, warn: console.warn, timeout: AbortSignal.timeout };
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];

// Five minutes ago, on the last of seven days that end a day after it, so it is on today.
const now = Date.now();
const recent = new Date(now - 5 * 60_000).toISOString();
const range = (daysAgo: number) => {
  const start = now - 5 * 60_000 - 3_600_000 - daysAgo * 86_400_000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 86_399_000).toISOString(),
    timezone: site.timeZone,
  };
};
// The week's daily summaries, oldest first; the default has coding only today.
const week = (seconds = [0, 0, 0, 0, 0, 0, 4860]) =>
  Response.json({
    data: seconds.map((total, i) => ({
      grand_total: { total_seconds: total },
      languages: total ? [{ name: i % 2 ? 'Rust' : 'TypeScript', total_seconds: total }] : [],
      projects: [{ name: 'secret-client-work' }],
      editors: [{ name: 'Zed' }],
      range: range(seconds.length - 1 - i),
    })),
  });
const user = (heartbeat: string | null = recent) =>
  Response.json({ data: { last_heartbeat_at: heartbeat, last_project: 'secret-client-work' } });
const shares = [
  { name: 'TypeScript', percent: 68 },
  { name: 'Astro', percent: 20 },
  { name: 'other', percent: 12 },
];
const stats = () =>
  Response.json({
    data: {
      range: 'last_30_days',
      is_up_to_date: true,
      languages: [
        { name: 'TypeScript', percent: 68 },
        { name: 'Astro', percent: 20 },
        { name: 'secret-client-work', percent: 12 },
      ],
      projects: [{ name: 'secret-client-work' }],
      editors: [{ name: 'Zed' }],
    },
  });

// Each test answers WakaTime's three endpoints and records the requests.
function wakatime(answers: {
  week?: () => Response | Promise<Response>;
  user?: () => Response;
  stats?: () => Response | Promise<Response>;
}) {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === summaries) {
      return (answers.week ?? week)();
    }
    if (url === lastMonth) {
      return (answers.stats ?? stats)();
    }
    return (answers.user ?? user)();
  };
}

beforeEach(() => {
  requests = [];
  warnings = [];
  console.warn = (message: string) => warnings.push(message);
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  console.warn = original.warn;
  AbortSignal.timeout = original.timeout;
});

test('loads today and the 30-day mix, and nothing private', async () => {
  wakatime({});
  const value = await load(key);
  assert.deepEqual(Object.keys(value ?? {}), ['state', 'language', 'today', 'at', 'shares']);
  // A five-minute-old heartbeat is still past activity, never presence.
  assert.equal(value?.state, 'idle');
  assert.equal(value?.language, 'TypeScript');
  assert.equal(value?.today, '1h 21m');
  assert.equal(value?.at, new Date(Math.floor(Date.parse(recent) / 60_000) * 60_000).toISOString());
  assert.deepEqual(value?.shares, shares);
  assert.doesNotMatch(JSON.stringify(value), /secret|projects|editors|Zed|Kolkata/);
});

test('a today without a minute loads the newest earlier day with one', async () => {
  wakatime({ week: () => week([0, 3000, 0, 7800, 59, 0, 20]) });
  const value = await load(key);
  assert.equal(value?.state, 'idle');
  assert.equal(value?.today, '2h 10m');
  assert.equal(value?.language, 'Rust');
  // The heartbeat is today's, a later day than the one shown, so the cell names none.
  assert.equal(value?.at, null);
  assert.deepEqual(value?.shares, shares);
});

test('asks WakaTime for the week in the site zone, with a Bearer token alone', async () => {
  wakatime({});
  await load(key);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [summaries, currentUser, lastMonth],
  );
  assert.equal(
    summaries,
    'https://wakatime.com/api/v1/users/current/summaries?range=Last+7+Days&timezone=Asia%2FKolkata',
  );
  for (const { init } of requests) {
    assert.deepEqual(init?.headers, { Authorization: `Bearer ${key}` });
    assert.ok(init?.signal instanceof AbortSignal);
  }
});

test('a missing key is no value, and WakaTime is not asked', async () => {
  for (const missing of [undefined, '']) {
    assert.equal(await load(missing), null);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(warnings, [
    'coding: no value from WakaTime (no WAKATIME_API_KEY)',
    'coding: no value from WakaTime (no WAKATIME_API_KEY)',
  ]);
});

test('oversized WakaTime bodies fail coding alone, with or without Content-Length', async () => {
  for (const source of ['week', 'user', 'stats'] as const) {
    for (const declared of [false, true]) {
      const normal = await { week, user, stats }[source]().json();
      const body = JSON.stringify({ ...normal, padding: 'x'.repeat(1_048_576) });
      wakatime({
        [source]: () =>
          new Response(body, {
            headers: declared ? { 'content-length': String(body.length) } : {},
          }),
      });
      assert.equal(await load(key), null, `${source}, declared=${declared}`);
      assert.equal(warnings.at(-1), 'coding: no value from WakaTime (RangeError)');
    }
  }
});

test('an upstream error, a bad body or a thrown fetch is no value', async () => {
  const cases: [Parameters<typeof wakatime>[0], string][] = [
    [{ week: () => new Response('no', { status: 503 }) }, 'HTTP 503'],
    [{ user: () => new Response('no', { status: 401 }) }, 'HTTP 401'],
    [{ stats: () => new Response('no', { status: 403 }) }, 'HTTP 403'],
    [{ stats: () => Response.json({ data: {} }, { status: 202 }) }, 'HTTP 202'],
    [
      {
        stats: () =>
          Response.json({ data: { range: 'last_30_days', languages: [], is_up_to_date: false } }),
      },
      'unexpected body',
    ],
    [
      {
        stats: () =>
          Response.json({
            data: {
              range: 'last_30_days',
              languages: [{ name: 'Go', percent: -1 }],
              is_up_to_date: true,
            },
          }),
      },
      'unexpected body',
    ],
    [{ week: () => Response.json({ data: {} }) }, 'unexpected body'],
    [{ week: () => Response.json({ data: [] }) }, 'unexpected body'],
    // A day without its range cannot be placed, so the whole week fails.
    [
      {
        week: () =>
          Response.json({ data: [{ grand_total: { total_seconds: 4860 }, languages: [] }] }),
      },
      'unexpected body',
    ],
    [{ week: () => new Response('{') }, 'SyntaxError'],
    [
      {
        week: () => {
          throw new TypeError(`network down, ${key} in the request`);
        },
      },
      'TypeError',
    ],
  ];
  for (const [answers, reason] of cases) {
    wakatime(answers);
    assert.equal(await load(key), null);
    assert.equal(warnings.at(-1), `coding: no value from WakaTime (${reason})`);
  }
  assert.doesNotMatch(warnings.join('\n'), new RegExp(key));
});

test('a week with no day of a minute is a value, not a failure', async () => {
  wakatime({ week: () => week([0, 59, 0, 0, 30, 0, 0]) });
  assert.deepEqual(await load(key), {
    state: 'empty',
    language: null,
    today: null,
    at: null,
    shares,
  });
});

test('an empty week with a malformed users/current body is no value', async () => {
  for (const body of [{ data: {} }, { data: { last_heartbeat_at: 'not a time' } }]) {
    wakatime({ week: () => week([0, 0, 0, 0, 0, 0, 0]), user: () => Response.json(body) });
    assert.equal(await load(key), null);
    assert.equal(warnings.at(-1), 'coding: no value from WakaTime (unexpected body)');
  }
});

test('one 2.5 s timeout covers all three requests and their bodies', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  wakatime({});
  await load(key);
  assert.deepEqual(budgets, [2_500]);
  assert.equal(requests[0].init?.signal, requests[1].init?.signal);
  assert.equal(requests[0].init?.signal, requests[2].init?.signal);
});
