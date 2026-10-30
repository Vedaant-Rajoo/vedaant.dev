import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { onRequestGet } from './now-playing';

const key = 'test-key-0123';
const track = {
  name: 'Song',
  artist: { '#text': 'Band' },
  album: { '#text': 'Record' },
  url: 'https://www.last.fm/music/Band/_/Song',
  date: { uts: '1760425439' },
};
// A user.getRecentTracks answer.
const recent = (value: unknown) => Response.json({ recenttracks: { track: value } });
const original = { fetch: globalThis.fetch, warn: console.warn };
let requests: { url: URL; init?: RequestInit }[];
let warnings: string[];

// Each test replaces fetch with an answer for Last.fm and records the request and the warnings.
function lastfm(answer: (signal?: AbortSignal | null) => Promise<Response> | Response) {
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return answer(init?.signal);
  };
}

// A visitor's request, with a query string and headers the Function must not pass on.
const get = (env: { LASTFM_API_KEY?: string } = { LASTFM_API_KEY: key }) => {
  const context = {
    env,
    request: new Request('https://vedaantrajoo.com/api/now-playing?user=x&api_key=y', {
      headers: { cookie: 'a=b', 'user-agent': 'visitor' },
    }),
  };
  return onRequestGet(context);
};

beforeEach(() => {
  requests = [];
  warnings = [];
  console.warn = (message: string) => warnings.push(message);
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  console.warn = original.warn;
});

async function assertAnswer(response: Response, body: unknown, cache: string) {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    'cache-control': cache,
    'content-security-policy': "default-src 'none'",
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex',
  });
  assert.deepEqual(await response.json(), body);
}

const failed = (response: Response) => assertAnswer(response, null, 'no-store');
const cached = 'public, max-age=0, s-maxage=30';

test('live and idle values in the snapshot shape, artwork null, cached for 30 s', async () => {
  const { date: _, ...playing } = track;
  lastfm(() => recent([{ ...playing, '@attr': { nowplaying: 'true' } }]));
  // A live track's `at` is the moment it was seen, coarsened to the minute.
  const now = Date.now;
  Date.now = () => Date.parse('2026-10-14T09:30:59Z');
  try {
    await assertAnswer(
      await get(),
      {
        state: 'live',
        track: 'Song',
        artist: 'Band',
        album: 'Record',
        at: '2026-10-14T09:30:00.000Z',
        url: 'https://www.last.fm/music/Band/_/Song',
        artwork: null,
      },
      cached,
    );
  } finally {
    Date.now = now;
  }

  lastfm(() => recent([track]));
  await assertAnswer(
    await get(),
    {
      state: 'idle',
      track: 'Song',
      artist: 'Band',
      album: 'Record',
      at: '2025-10-14T07:03:00.000Z',
      url: 'https://www.last.fm/music/Band/_/Song',
      artwork: null,
    },
    cached,
  );
  assert.deepEqual(warnings, []);
});

test('empty is a value, not a failure', async () => {
  lastfm(() => recent([]));
  await assertAnswer(
    await get(),
    { state: 'empty', track: null, artist: null, album: null, at: null, url: null, artwork: null },
    cached,
  );
});

test('asks Last.fm for one track with the key, and passes on nothing of the request', async () => {
  lastfm(() => recent([track]));
  await get();
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url.origin + url.pathname, 'https://ws.audioscrobbler.com/2.0/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    method: 'user.getrecenttracks',
    user: 'newedia',
    limit: '1',
    format: 'json',
    api_key: key,
  });
  assert.equal(init?.headers, undefined);
  assert.equal(init?.method, undefined);
});

test('a bad body or an upstream error answers null with no-store', async () => {
  for (const answer of [
    () => Response.json({ error: 10, message: 'Invalid API key' }),
    () => new Response('<html>', { status: 200 }),
    () => new Response('', { status: 503 }),
    () => Promise.reject(new TypeError(`fetch failed: ${requests.at(-1)?.url}`)),
    () => Promise.reject('not an Error'),
  ]) {
    lastfm(answer);
    await failed(await get());
  }
  assert.deepEqual(warnings, [
    'now-playing: no value from Last.fm (unexpected body)',
    'now-playing: no value from Last.fm (SyntaxError)',
    'now-playing: no value from Last.fm (HTTP 503)',
    'now-playing: no value from Last.fm (TypeError)',
    'now-playing: no value from Last.fm (unknown error)',
  ]);
  assert.ok(warnings.every((warning) => !warning.includes(key)));
});

test('a missing or empty key answers null without asking Last.fm', async () => {
  lastfm(() => recent([track]));
  await failed(await get({}));
  await failed(await get({ LASTFM_API_KEY: '' }));
  assert.equal(requests.length, 0);
  assert.deepEqual(warnings, [
    'now-playing: no value from Last.fm (no LASTFM_API_KEY)',
    'now-playing: no value from Last.fm (no LASTFM_API_KEY)',
  ]);
});

// The 2.5 s signal is replaced by one the test aborts, so the case takes no wall-clock time.
test('one 2.5 s timeout covers the request and its body', async () => {
  const timeout = AbortSignal.timeout;
  const timers: AbortController[] = [];
  const budgets: number[] = [];
  // Recorded, not asserted: an assertion here would throw inside the Function's own catch.
  AbortSignal.timeout = (milliseconds: number) => {
    budgets.push(milliseconds);
    timers.push(new AbortController());
    return timers[timers.length - 1].signal;
  };
  const stalled = (signal?: AbortSignal | null) =>
    new ReadableStream({
      start: (body) => signal?.addEventListener('abort', () => body.error(signal.reason)),
    });
  try {
    for (const answer of [
      (signal?: AbortSignal | null) =>
        new Promise<Response>((_, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason)),
        ),
      (signal?: AbortSignal | null) => new Response(stalled(signal), { status: 200 }),
    ]) {
      lastfm(answer);
      const answered = get();
      timers[timers.length - 1].abort(new DOMException('timed out', 'TimeoutError'));
      await failed(await answered);
    }
  } finally {
    AbortSignal.timeout = timeout;
  }
  assert.deepEqual(budgets, [2_500, 2_500]);
  assert.deepEqual(warnings, [
    'now-playing: no value from Last.fm (TimeoutError)',
    'now-playing: no value from Last.fm (TimeoutError)',
  ]);
});

// Any other export (onRequest, onRequestPost) would make Pages answer more than GET.
test('exports only the GET handler', async () => {
  assert.deepEqual(Object.keys(await import('./now-playing')), ['onRequestGet']);
});
