import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { currentUser, lastMonth, lastWeek } from '../../src/data/coding';
import { graphql } from '../../src/data/contributions';
import { topAlbums } from '../../src/data/now-playing';
import { hardcover, letterboxd } from '../../src/data/shelf-live';
import site from '../../src/data/site.json';
import { handle } from './activity';

const env = {
  WAKATIME_API_KEY: 'waka-key',
  CONTRIBUTIONS_TOKEN: 'gh-token',
  HARDCOVER_TOKEN: 'hc-token',
  LASTFM_API_KEY: 'fm-key',
};
const origin = 'https://vedaantrajoo.com';
const original = {
  fetch: globalThis.fetch,
  warn: console.warn,
  timeout: AbortSignal.timeout,
  now: Date.now,
};
const start = Date.parse('2026-11-01T12:00:00Z');
let now: number;
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];
let store: Map<string, Response>;
let waits: Promise<unknown>[];

// The Cache API, as a Map of the URLs a test reads back. It never expires an entry, so the tests
// age one by moving Date.now.
const cache = {
  match: async (url: string) => store.get(url)?.clone(),
  put: async (url: string, response: Response) => {
    store.set(url, response);
  },
} as unknown as Cache;

const heartbeat = new Date(start - 5 * 60_000).toISOString();
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Each day's contribution count: its day of the month.
const count = (ms: number) => Number(date(ms).slice(8));
// GitHub's calendar for the request's own two ranges, so it follows the mocked Date.now.
const calendar = (from: string, to: string) => {
  const days = [];
  for (
    let at = Date.parse(from.slice(0, 10));
    at <= Date.parse(to.slice(0, 10));
    at += 86_400_000
  ) {
    days.push({ date: date(at), contributionCount: count(at), contributionLevel: 'NONE' });
  }
  return {
    commitContributionsByRepository: [{ repository: { name: 'secret-client-work' } }],
    contributionCalendar: { weeks: [{ contributionDays: days }] },
  };
};
// Each source's answer as its upstream gives it, secrets the Function must drop included.
const upstream: Record<string, (init?: RequestInit) => Response | Promise<Response>> = {
  // One day, 1 November in Kolkata, which holds the heartbeat.
  [lastWeek(site.timeZone)]: () =>
    Response.json({
      data: [
        {
          grand_total: { total_seconds: 4860 },
          languages: [{ name: 'TypeScript', total_seconds: 4860 }],
          projects: [{ name: 'secret-client-work' }],
          range: { start: '2026-10-31T18:30:00Z', end: '2026-11-01T18:29:59Z' },
        },
      ],
    }),
  [currentUser]: () =>
    Response.json({ data: { last_heartbeat_at: heartbeat, last_project: 'secret-client-work' } }),
  [lastMonth]: () =>
    Response.json({
      data: {
        range: 'last_30_days',
        is_up_to_date: true,
        languages: [{ name: 'TypeScript', percent: 100 }],
        editors: [{ name: 'Zed' }],
      },
    }),
  [graphql]: (init) => {
    const { a, b, c, d } = JSON.parse(String(init?.body)).variables;
    return Response.json({ data: { user: { head: calendar(a, b), tail: calendar(c, d) } } });
  },
  [hardcover]: () =>
    Response.json({
      data: {
        user_books: [
          {
            book: {
              title: 'Dune',
              contributions: [{ contribution: null, author: { name: 'Frank Herbert' } }],
            },
            user_book_reads: [{ started_at: '2026-10-03', progress_pages: 120 }],
          },
        ],
      },
    }),
  [letterboxd]: () =>
    new Response(
      '<rss><channel><item><letterboxd:watchedDate>2026-10-28</letterboxd:watchedDate><letterboxd:filmTitle>Clueless</letterboxd:filmTitle><letterboxd:filmYear>1995</letterboxd:filmYear><letterboxd:memberRating>3.5</letterboxd:memberRating></item></channel></rss>',
    ),
  [topAlbums(env.LASTFM_API_KEY)]: () =>
    Response.json({
      topalbums: { album: [{ name: 'STAY ALIVE', playcount: '7', artist: { name: 'JUNGKOOK' } }] },
    }),
};
const full = {
  coding: {
    state: 'idle',
    language: 'TypeScript',
    today: '1h 21m',
    at: heartbeat.replace(/:\d\d\.\d+Z$/, ':00.000Z'),
    shares: [{ name: 'TypeScript', percent: 100 }],
  },
  // The test's day is a Sunday, so the window is 52 whole weeks and that one day.
  contributions: {
    end: '2026-11-01',
    days: Array.from({ length: 365 }, (_, i) => count(Date.parse('2025-11-02') + i * 86_400_000)),
  },
  reading: { title: 'Dune', creator: 'Frank Herbert', started: '2026-10', page: 120 },
  lastWatched: { title: 'Clueless', year: 1995, rating: 3.5, date: '2026-10-28' },
  listening: { title: 'STAY ALIVE', creator: 'JUNGKOOK', plays: 7 },
};

// Answers each upstream URL from `upstream`, with `overrides` replacing some.
function sources(
  overrides: Record<string, (init?: RequestInit) => Response | Promise<Response>> = {},
) {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const answer = overrides[url] ?? upstream[url];
    assert.ok(answer, `unexpected request to ${url}`);
    return answer(init);
  };
}

const get = (keys: Partial<typeof env> = env) => {
  const context = {
    env: keys,
    request: new Request(`${origin}/api/activity?user=x`, {
      headers: { cookie: 'a=b', 'user-agent': 'visitor' },
    }),
    waitUntil(promise: Promise<unknown>) {
      assert.equal(this, context);
      waits.push(promise);
    },
  };
  return handle(context, cache);
};

beforeEach(() => {
  now = start;
  Date.now = () => now;
  requests = [];
  warnings = [];
  waits = [];
  store = new Map();
  console.warn = (message: string) => warnings.push(message);
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  console.warn = original.warn;
  AbortSignal.timeout = original.timeout;
  Date.now = original.now;
});

const fixed = {
  'content-security-policy': "default-src 'none'",
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
};
const daily = 'public, max-age=86400, s-maxage=86400';

test('every source answering: one body, kept a day by the edge and the browser', async () => {
  sources();
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    ...fixed,
    'cache-control': daily,
    date: new Date(start).toUTCString(),
    expires: new Date(start + 86_400_000).toUTCString(),
    'x-cache': 'miss',
  });
  const body = await response.json();
  assert.deepEqual(body, full);
  assert.deepEqual(Object.keys(body), [
    'coding',
    'contributions',
    'reading',
    'lastWatched',
    'listening',
  ]);
  assert.doesNotMatch(JSON.stringify(body), /secret|editors|Zed|project|repository|NONE/);
  assert.deepEqual(warnings, []);
  await Promise.all(waits);
  assert.deepEqual([...store.keys()], [`${origin}/api/activity`]);
});

test('seven upstream requests, all at once, carrying nothing of the visitor', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = Object.fromEntries(
    Object.entries(upstream).map(([url, answer]) => [
      url,
      (init?: RequestInit) => held.then(() => answer(init)),
    ]),
  );
  sources(slow);
  const pending = get();
  for (let turn = 0; turn < 50 && requests.length < 7; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // Every request starts before any answers: the slowest source, not their sum, bounds the wait.
  assert.equal(requests.length, 7);
  release();
  assert.deepEqual(await (await pending).json(), full);
  // WakaTime's one 2.5 s for its three, GitHub's, Hardcover's and Letterboxd's 3 s, Last.fm's 2.5 s.
  assert.deepEqual(budgets.sort(), [2_500, 2_500, 3_000, 3_000, 3_000]);
  for (const { url, init } of requests) {
    assert.doesNotMatch(url, /user=x|visitor/);
    assert.doesNotMatch(JSON.stringify(init?.headers ?? {}), /cookie|visitor/i);
  }
});

test('a later hit carries its age, so a browser keeps it only for what is left', async () => {
  sources();
  await get();
  await Promise.all(waits);
  for (const elapsed of [0, 3_600, 86_399]) {
    now = start + elapsed * 1000;
    const hit = await get();
    assert.equal(hit.headers.get('x-cache'), 'hit');
    assert.equal(hit.headers.get('cache-control'), daily);
    // The Date the body was made with, and the Expires it goes stale at, not the hit's.
    assert.equal(hit.headers.get('date'), new Date(start).toUTCString());
    assert.equal(hit.headers.get('expires'), new Date(start + 86_400_000).toUTCString());
    assert.equal(hit.headers.get('age'), String(elapsed));
    assert.deepEqual(await hit.json(), full);
  }
  assert.equal(requests.length, 7);
  // A day on, a cache that still holds the entry is not trusted: the sources are asked again.
  now = start + 86_400_000;
  const fresh = await get();
  assert.equal(fresh.headers.get('x-cache'), 'miss');
  assert.equal(fresh.headers.get('age'), null);
  assert.equal(fresh.headers.get('date'), new Date(now).toUTCString());
  assert.equal(requests.length, 14);
  // Monday's window holds one more day, and the answer is whole again, so it is kept a day.
  assert.equal(fresh.headers.get('cache-control'), daily);
  const { contributions } = await fresh.json();
  assert.equal(contributions.end, '2026-11-02');
  assert.equal(contributions.days.length, 366);
});

test('nothing current is a value: null rows, kept a day like any answer', async () => {
  sources({
    [hardcover]: () => Response.json({ data: { user_books: [] } }),
    [letterboxd]: () => new Response('<rss><channel></channel></rss>'),
    [topAlbums(env.LASTFM_API_KEY)]: () => Response.json({ topalbums: { album: [] } }),
  });
  const response = await get();
  assert.equal(response.headers.get('cache-control'), daily);
  assert.deepEqual(await response.json(), {
    coding: full.coding,
    contributions: full.contributions,
    reading: null,
    lastWatched: null,
    listening: null,
  });
});

test('a failed source is left out, the rest answer, and the answer is kept 10 minutes', async () => {
  const cases: [Partial<typeof env>, Record<string, () => Response>, string, string][] = [
    [
      { ...env, HARDCOVER_TOKEN: undefined },
      {},
      'reading',
      'reading: no value from Hardcover (no HARDCOVER_TOKEN)',
    ],
    [
      env,
      { [lastWeek(site.timeZone)]: () => new Response('no', { status: 503 }) },
      'coding',
      'coding: no value from WakaTime (HTTP 503)',
    ],
    [
      { ...env, CONTRIBUTIONS_TOKEN: undefined },
      {},
      'contributions',
      'contributions: no value from GitHub (no CONTRIBUTIONS_TOKEN)',
    ],
    [
      env,
      {
        [graphql]: () =>
          Response.json({ errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] }),
      },
      'contributions',
      'contributions: no value from GitHub (GraphQL RATE_LIMITED)',
    ],
    [
      env,
      { [letterboxd]: () => new Response('<!DOCTYPE html><html></html>') },
      'lastWatched',
      'last-watched: no value from Letterboxd (unexpected body)',
    ],
    [
      env,
      { [topAlbums(env.LASTFM_API_KEY)]: () => Response.json({ error: 29 }) },
      'listening',
      'on-repeat: no value from Last.fm (unexpected body)',
    ],
  ];
  for (const [keys, overrides, missing, warning] of cases) {
    store.clear();
    warnings = [];
    sources(overrides);
    const response = await get(keys);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=600, s-maxage=600');
    assert.equal(response.headers.get('expires'), new Date(now + 600_000).toUTCString());
    const { [missing as keyof typeof full]: _, ...rest } = full;
    assert.deepEqual(await response.json(), rest);
    assert.deepEqual(warnings, [warning]);
  }
  // A missing key or a failed source can only shorten how long the answer is kept, a hit after 10
  // minutes included.
  await Promise.all(waits);
  now += 600_000;
  assert.equal((await get()).headers.get('x-cache'), 'miss');
});

test('every source failing answers null with no-store, never stored', async () => {
  const down = () => {
    throw new TypeError(`network down, ${env.LASTFM_API_KEY}`);
  };
  sources(Object.fromEntries(Object.keys(upstream).map((url) => [url, down])));
  for (const keys of [env, {}]) {
    const response = await get(keys);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('expires'), null);
    assert.equal(await response.json(), null);
  }
  await Promise.all(waits);
  assert.equal(store.size, 0);
  assert.doesNotMatch(warnings.join('\n'), /waka-key|gh-token|hc-token|fm-key/);
});

// Any other export (onRequest, onRequestPost) would make Pages answer more than GET.
test('exports only the GET handler', async () => {
  const handlers = Object.keys(await import('./activity')).filter((name) =>
    name.startsWith('onRequest'),
  );
  assert.deepEqual(handlers, ['onRequestGet']);
});
