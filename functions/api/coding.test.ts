import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { currentUser, statusBar } from '../../src/data/coding';
import { handle } from './coding';

const key = 'waka-test-key';
const origin = 'https://vedaantrajoo.com';
const original = { fetch: globalThis.fetch, warn: console.warn, timeout: AbortSignal.timeout };
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];
let store: Map<string, Response>;
let waits: Promise<unknown>[];

// The Cache API, as a Map of the URLs a test reads back.
const cache = {
  match: async (url: string) => store.get(url)?.clone(),
  put: async (url: string, response: Response) => {
    store.set(url, response);
  },
} as unknown as Cache;

const recent = new Date(Date.now() - 5 * 60_000).toISOString();
const bar = (seconds = 4860) =>
  Response.json({
    data: {
      grand_total: { total_seconds: seconds },
      languages: [{ name: 'TypeScript', total_seconds: seconds }],
      projects: [{ name: 'secret-client-work' }],
    },
  });
const user = (heartbeat: string | null = recent) =>
  Response.json({ data: { last_heartbeat_at: heartbeat, last_project: 'secret-client-work' } });

// Each test answers WakaTime's two endpoints and records the requests.
function wakatime(answers: { bar?: () => Response | Promise<Response>; user?: () => Response }) {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    return url === statusBar ? (answers.bar ?? bar)() : (answers.user ?? user)();
  };
}

const get = (env: { WAKATIME_API_KEY?: string } = { WAKATIME_API_KEY: key }) => {
  const context = {
    env,
    request: new Request(`${origin}/api/coding?user=x`, {
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
});

const fixed = {
  'content-security-policy': "default-src 'none'",
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
};

test('answers today in the four-field shape, kept 60 s, then from the cache', async () => {
  wakatime({});
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    ...fixed,
    'cache-control': 'public, max-age=0, s-maxage=60',
    'x-cache': 'miss',
  });
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['state', 'language', 'today', 'at']);
  assert.equal(body.state, 'live');
  assert.equal(body.language, 'TypeScript');
  assert.equal(body.today, '1h 21m');
  assert.doesNotMatch(JSON.stringify(body), /secret/);
  await Promise.all(waits);
  assert.ok(store.has(`${origin}/api/coding`));
  const again = await get();
  assert.equal(again.headers.get('x-cache'), 'hit');
  assert.equal(requests.length, 2);
});

test('asks WakaTime with the key as Basic auth, and passes on nothing of the request', async () => {
  wakatime({});
  await get();
  assert.deepEqual(
    requests.map(({ url }) => url),
    [statusBar, currentUser],
  );
  for (const { init } of requests) {
    assert.deepEqual(init?.headers, { Authorization: `Basic ${btoa(key)}` });
    assert.ok(init?.signal instanceof AbortSignal);
  }
});

test('a missing key answers null without asking WakaTime', async () => {
  for (const env of [{}, { WAKATIME_API_KEY: '' }]) {
    const response = await get(env);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.json(), null);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(warnings, [
    'coding: no value from WakaTime (no WAKATIME_API_KEY)',
    'coding: no value from WakaTime (no WAKATIME_API_KEY)',
  ]);
  assert.equal(store.size, 0);
});

test('an upstream error, a bad body or a thrown fetch answers null, never stored', async () => {
  const cases: [Parameters<typeof wakatime>[0], string][] = [
    [{ bar: () => new Response('no', { status: 503 }) }, 'HTTP 503'],
    [{ user: () => new Response('no', { status: 401 }) }, 'HTTP 401'],
    [{ bar: () => Response.json({ data: {} }) }, 'unexpected body'],
    [{ bar: () => new Response('{') }, 'SyntaxError'],
    [
      {
        bar: () => {
          throw new TypeError('network down, key in the URL');
        },
      },
      'TypeError',
    ],
  ];
  for (const [answers, reason] of cases) {
    wakatime(answers);
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.json(), null);
    assert.equal(warnings.at(-1), `coding: no value from WakaTime (${reason})`);
  }
  assert.equal(store.size, 0);
});

test('a day with no coding is a value, not a failure', async () => {
  wakatime({ bar: () => bar(0) });
  const response = await get();
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, s-maxage=60');
  assert.deepEqual(await response.json(), {
    state: 'empty',
    language: null,
    today: null,
    at: null,
  });
});

test('an empty day with a malformed users/current body is a failure, never stored', async () => {
  for (const body of [{ data: {} }, { data: { last_heartbeat_at: 'not a time' } }]) {
    wakatime({ bar: () => bar(0), user: () => Response.json(body) });
    const response = await get();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.json(), null);
    assert.equal(warnings.at(-1), 'coding: no value from WakaTime (unexpected body)');
  }
  assert.equal(store.size, 0);
});

test('one 2.5 s timeout covers both requests and their bodies', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  wakatime({});
  await get();
  assert.deepEqual(budgets, [2_500]);
  assert.equal(requests[0].init?.signal, requests[1].init?.signal);
});

// Any other export (onRequest, onRequestPost) would make Pages answer more than GET.
test('exports only the GET handler', async () => {
  const handlers = Object.keys(await import('./coding')).filter((name) =>
    name.startsWith('onRequest'),
  );
  assert.deepEqual(handlers, ['onRequestGet']);
});
