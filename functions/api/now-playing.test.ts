import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { artworkKey } from '../../src/data/artwork';
import type { NowPlaying } from '../../src/data/now-playing';
import { handle } from './now-playing';

const key = 'test-key-0123';
const origin = 'https://vedaantrajoo.com';
const track = {
  name: 'Song',
  artist: { '#text': 'Band' },
  album: { '#text': 'Record' },
  url: 'https://www.last.fm/music/Band/_/Song',
  date: { uts: '1760425439' },
};
const art = 'https://coverartarchive.org/release/391feb5b-ed43-459b-adfe-f7ae874175fe/front-250';
// A user.getRecentTracks answer.
const recent = (value: unknown) => Response.json({ recenttracks: { track: value } });
const original = {
  fetch: globalThis.fetch,
  warn: console.warn,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};
type Answer = (signal?: AbortSignal | null) => Promise<Response> | Response;
type Deadline = { fire: () => void; cleared: boolean };
let requests: { url: URL; init?: RequestInit }[];
let warnings: string[];
let store: Map<string, Response>;
let waits: Promise<unknown>[];
let musicbrainz: Answer;
let deadlines: Deadline[];

// The Function's 1.5 s artwork deadline is held for the test to fire, so no case depends on how
// long a lookup takes; other timers, such as artwork.ts's MusicBrainz spacing, run as usual.
function holdDeadlines() {
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== 1_500) {
      return original.setTimeout(callback, delay, ...args);
    }
    const deadline = { fire: () => callback(...args), cleared: false };
    deadlines.push(deadline);
    return deadline;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id) => {
    const deadline = deadlines.find((held) => held === (id as unknown));
    if (deadline) {
      deadline.cleared = true;
    } else {
      original.clearTimeout(id);
    }
  }) as typeof clearTimeout;
}

// Waits a few turns of the event loop, until the Function has set its artwork deadline.
async function deadline() {
  for (let turn = 0; turn < 50 && deadlines.length === 0; turn++) {
    await new Promise((resolve) => original.setTimeout(resolve, 0));
  }
  return deadlines[0];
}

// The Cache API, as a Map of the URLs a test reads back.
const cache = {
  match: async (url: string) => store.get(url)?.clone(),
  put: async (url: string, response: Response) => {
    store.set(url, response);
  },
} as unknown as Cache;
const artworkUrl = (value: Pick<NowPlaying, 'artist' | 'track' | 'album'>) =>
  `${origin}/api/now-playing/artwork?k=${encodeURIComponent(artworkKey(value as NowPlaying))}`;

// Each test replaces fetch with answers for Last.fm and MusicBrainz, and records the requests.
// Cover Art Archive has every image; MusicBrainz finds nothing unless a test says so.
function lastfm(answer: Answer) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.hostname === 'musicbrainz.org') {
      return musicbrainz(init?.signal);
    }
    if (url.hostname === 'coverartarchive.org') {
      return new Response(null, { headers: { 'content-type': 'image/jpeg' } });
    }
    return answer(init?.signal);
  };
}

// A release MusicBrainz finds for a title, credited to the artist.
const release = (id: string, title: string, artist: string) =>
  Response.json({ releases: [{ id, title, 'artist-credit': [{ name: artist }] }] });

// A visitor's request, with a query string and headers the Function must not pass on. waitUntil
// checks it is called on the context, as workerd requires.
const get = (
  env: { LASTFM_API_KEY?: string } = { LASTFM_API_KEY: key },
  path = '/api/now-playing?user=x&api_key=y',
  using = cache,
) => {
  const context = {
    env,
    request: new Request(`${origin}${path}`, {
      headers: { cookie: 'a=b', 'user-agent': 'visitor' },
    }),
    waitUntil(promise: Promise<unknown>) {
      assert.equal(this, context);
      waits.push(promise);
    },
  };
  return handle(context, using);
};

beforeEach(() => {
  requests = [];
  warnings = [];
  waits = [];
  deadlines = [];
  holdDeadlines();
  // The test track's artwork is already cached, so only the artwork tests look anything up.
  store = new Map([
    [artworkUrl({ artist: 'Band', track: 'Song', album: 'Record' }), new Response(art)],
  ]);
  musicbrainz = () => Response.json({ releases: [] });
  console.warn = (message: string) => warnings.push(message);
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  console.warn = original.warn;
  globalThis.setTimeout = original.setTimeout;
  globalThis.clearTimeout = original.clearTimeout;
});

const fixed = {
  'content-security-policy': "default-src 'none'",
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
};

async function assertAnswer(response: Response, body: unknown, cache: string, from = 'miss') {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    ...fixed,
    'cache-control': cache,
    'x-cache': from,
  });
  assert.deepEqual(await response.json(), body);
}

const failed = (response: Response) => assertAnswer(response, null, 'no-store');
const shared = 'public, max-age=0, s-maxage=30';
const idle = {
  state: 'idle',
  track: 'Song',
  artist: 'Band',
  album: 'Record',
  at: '2025-10-14T07:03:00.000Z',
  url: 'https://www.last.fm/music/Band/_/Song',
  artwork: art,
};
const answerUrl = `${origin}/api/now-playing`;

test('live and idle values in the snapshot shape, with cached artwork, kept for 30 s', async () => {
  const { date: _, ...playing } = track;
  lastfm(() => recent([{ ...playing, '@attr': { nowplaying: 'true' } }]));
  // A live track's `at` is the moment it was seen, coarsened to the minute.
  const now = Date.now;
  Date.now = () => Date.parse('2026-10-14T09:30:59Z');
  try {
    await assertAnswer(
      await get(),
      { ...idle, state: 'live', at: '2026-10-14T09:30:00.000Z' },
      shared,
    );
  } finally {
    Date.now = now;
  }

  store.delete(answerUrl);
  lastfm(() => recent([track]));
  await assertAnswer(await get(), idle, shared);
  assert.deepEqual(warnings, []);
});

test('empty is a value, not a failure, and looks nothing up', async () => {
  lastfm(() => recent([]));
  await assertAnswer(
    await get(),
    { state: 'empty', track: null, artist: null, album: null, at: null, url: null, artwork: null },
    shared,
  );
  assert.equal(requests.length, 1);
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

test('a second request within the entry answers from the cache, query string or not', async () => {
  lastfm(() => recent([track]));
  const first = await get();
  await Promise.all(waits);
  assert.deepEqual([...store.keys()].sort(), [
    answerUrl,
    artworkUrl({ artist: 'Band', track: 'Song', album: 'Record' }),
  ]);
  await assertAnswer(await get(undefined, '/api/now-playing'), idle, shared, 'hit');
  await assertAnswer(first, idle, shared);
  assert.equal(requests.length, 1);
});

test('a failure is never stored, and an expired entry is not served', async () => {
  lastfm(() => recent([track]));
  await get();
  await Promise.all(waits);
  // The entry expires, then Last.fm fails: the answer is null, not the old body.
  store.delete(answerUrl);
  lastfm(() => new Response('', { status: 503 }));
  await failed(await get());
  await Promise.all(waits);
  assert.equal(store.has(answerUrl), false);
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
  assert.equal(store.has(answerUrl), false);
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
      // The Function reads the cache first, so the timer exists only once Last.fm is asked.
      let asked = () => {};
      const sent = new Promise<void>((resolve) => {
        asked = resolve;
      });
      lastfm((signal) => {
        asked();
        return answer(signal);
      });
      const answered = get();
      await sent;
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

test('artwork found within 1.5 s is in the answer and kept for 30 days', async () => {
  const id = '20650fa6-385c-44c6-a12a-31a513589858';
  const value = { artist: 'Group', track: 'Other', album: 'Album' };
  musicbrainz = () => release(id, 'Album', 'Group');
  lastfm(() =>
    recent([
      { ...track, name: 'Other', artist: { '#text': 'Group' }, album: { '#text': 'Album' } },
    ]),
  );
  const body = await (await get()).json();
  await Promise.all(waits);
  const cover = `https://coverartarchive.org/release/${id}/front-250`;
  assert.equal(body.artwork, cover);
  // One 1.5 s deadline, cleared once the lookup won.
  assert.equal(deadlines.length, 1);
  assert.equal(deadlines[0].cleared, true);
  const kept = store.get(artworkUrl(value));
  assert.equal(kept?.headers.get('cache-control'), 'public, max-age=2592000');
  assert.equal(await kept?.clone().text(), cover);
});

test('a slower lookup answers without artwork and finishes under waitUntil', async () => {
  const id = '2453aee5-6f3e-4674-97b7-7ba611f37382';
  const value = { artist: 'Group', track: 'Late', album: 'Slow' };
  let found = () => {};
  const searched = new Promise<void>((resolve) => {
    found = resolve;
  });
  musicbrainz = async () => {
    await searched;
    return release(id, 'Slow', 'Group');
  };
  lastfm(() =>
    recent([{ ...track, name: 'Late', artist: { '#text': 'Group' }, album: { '#text': 'Slow' } }]),
  );
  const answered = get();
  (await deadline()).fire();
  assert.equal((await (await answered).json()).artwork, null);
  // The lookup and the answer's put are both handed to waitUntil; nothing is stored yet.
  assert.equal(waits.length, 2);
  assert.equal(store.has(artworkUrl(value)), false);
  found();
  await Promise.all(waits);
  const cover = `https://coverartarchive.org/release/${id}/front-250`;
  const kept = store.get(artworkUrl(value));
  assert.equal(kept?.headers.get('cache-control'), 'public, max-age=2592000');
  assert.equal(await kept?.clone().text(), cover);
  // The answer's 30 s pass; the next answer takes the artwork from the cache.
  store.delete(answerUrl);
  const searches = requests.filter(({ url }) => url.hostname === 'musicbrainz.org').length;
  assert.equal((await (await get()).json()).artwork, cover);
  assert.equal(requests.filter(({ url }) => url.hostname === 'musicbrainz.org').length, searches);
});

test('a failing Cache API still answers the value, never a 5xx', async () => {
  const id = '6e1f6a8e-6b0c-4d2a-9a4e-0d2b8f0f8b11';
  const broken = {
    match: () => Promise.reject(new Error('unavailable')),
    put: () => Promise.reject(new Error('unavailable')),
  } as unknown as Cache;
  musicbrainz = () => release(id, 'Fault', 'Group');
  lastfm(() =>
    recent([{ ...track, name: 'Down', artist: { '#text': 'Group' }, album: { '#text': 'Fault' } }]),
  );
  const response = await get(undefined, undefined, broken);
  await Promise.all(waits);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-cache'), 'miss');
  assert.equal(response.headers.get('cache-control'), shared);
  const body = await response.json();
  assert.equal(body.track, 'Down');
  assert.equal(body.artwork, `https://coverartarchive.org/release/${id}/front-250`);
  assert.deepEqual(warnings, []);
});

test('storing the artwork never holds the answer', async () => {
  const id = '0f3b9c2e-5d4a-4e6b-8c7d-1a2b3c4d5e6f';
  // A put that never settles: the answer must not wait for it, and the deadline never fires.
  const stuck = {
    match: async () => undefined,
    put: () => new Promise(() => {}),
  } as unknown as Cache;
  musicbrainz = () => release(id, 'Stall', 'Group');
  lastfm(() =>
    recent([{ ...track, name: 'Held', artist: { '#text': 'Group' }, album: { '#text': 'Stall' } }]),
  );
  const body = await (await get(undefined, undefined, stuck)).json();
  assert.equal(body.artwork, `https://coverartarchive.org/release/${id}/front-250`);
  assert.equal(deadlines[0].cleared, true);
});

// Any other export (onRequest, onRequestPost) would make Pages answer more than GET.
test('exports only the GET handler', async () => {
  const handlers = Object.keys(await import('./now-playing')).filter((name) =>
    name.startsWith('onRequest'),
  );
  assert.deepEqual(handlers, ['onRequestGet']);
});
