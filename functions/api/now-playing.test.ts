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
  env: Parameters<typeof handle>[0]['env'] = { LASTFM_API_KEY: key },
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

// A KV namespace as a Map, recording its reads and writes; `broken` makes both reject.
function kvStore(entries: [string, string][] = [], broken = false) {
  const data = new Map(entries);
  const kv = {
    data,
    gets: [] as string[],
    puts: [] as [string, string][],
    get: async (name: string) => {
      kv.gets.push(name);
      if (broken) {
        throw new Error('unavailable');
      }
      return data.get(name) ?? null;
    },
    put: async (name: string, url: string) => {
      kv.puts.push([name, url]);
      if (broken) {
        throw new Error('unavailable');
      }
      data.set(name, url);
    },
  };
  return kv;
}
const kvName = (value: Pick<NowPlaying, 'artist' | 'track' | 'album'>) =>
  `artwork:${artworkKey(value as NowPlaying)}`;
const searches = () => requests.filter(({ url }) => url.hostname === 'musicbrainz.org').length;

test('a bound KV answers artwork the Cache API lacks, with no lookup, and refills the cache', async () => {
  const value = { artist: 'Store', track: 'Kept', album: 'Shelf' };
  const cover =
    'https://coverartarchive.org/release/7d1c2f8e-3a4b-4c5d-8e9f-0a1b2c3d4e5f/front-250';
  const kv = kvStore([[kvName(value), cover]]);
  lastfm(() =>
    recent([{ ...track, name: 'Kept', artist: { '#text': 'Store' }, album: { '#text': 'Shelf' } }]),
  );
  const body = await (await get({ LASTFM_API_KEY: key, ARTWORK: kv })).json();
  await Promise.all(waits);
  assert.equal(body.artwork, cover);
  assert.equal(searches(), 0);
  // The KV read ran under the 1.5 s deadline, which was cleared once KV answered.
  assert.equal(deadlines.length, 1);
  assert.equal(deadlines[0].cleared, true);
  assert.deepEqual(kv.puts, []);
  const refilled = store.get(artworkUrl(value));
  assert.equal(refilled?.headers.get('cache-control'), 'public, max-age=2592000');
  assert.equal(await refilled?.clone().text(), cover);
  // The Cache API answers first: with its entry back, KV is not read again.
  store.delete(answerUrl);
  await get({ LASTFM_API_KEY: key, ARTWORK: kv });
  assert.equal(kv.gets.length, 1);
});

test('a found artwork is put in KV once, and a lookup that finds nothing is not', async () => {
  const id = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const value = { artist: 'Twice', track: 'Once', album: 'Written' };
  const kv = kvStore();
  musicbrainz = () => release(id, 'Written', 'Twice');
  lastfm(() =>
    recent([
      { ...track, name: 'Once', artist: { '#text': 'Twice' }, album: { '#text': 'Written' } },
    ]),
  );
  const cover = `https://coverartarchive.org/release/${id}/front-250`;
  assert.equal((await (await get({ LASTFM_API_KEY: key, ARTWORK: kv })).json()).artwork, cover);
  await Promise.all(waits);
  assert.deepEqual(kv.puts, [[kvName(value), cover]]);
  // Another data centre: no answer and no artwork in its Cache API, so KV answers.
  store.clear();
  const looked = searches();
  assert.equal((await (await get({ LASTFM_API_KEY: key, ARTWORK: kv })).json()).artwork, cover);
  await Promise.all(waits);
  // The answer came from KV's second read, not from artwork.ts's remembered lookup.
  assert.equal(kv.gets.length, 2);
  assert.equal(searches(), looked);
  assert.equal(kv.puts.length, 1);
  // A track MusicBrainz cannot match writes nothing.
  musicbrainz = () => Response.json({ releases: [] });
  lastfm(() =>
    recent([{ ...track, name: 'None', artist: { '#text': 'Bare' }, album: { '#text': 'Plain' } }]),
  );
  store.clear();
  assert.equal((await (await get({ LASTFM_API_KEY: key, ARTWORK: kv })).json()).artwork, null);
  await Promise.all(waits);
  assert.equal(kv.puts.length, 1);
});

test('a failing KV counts as a miss and never holds or breaks the answer', async () => {
  const id = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
  const kv = kvStore([], true);
  musicbrainz = () => release(id, 'Broken', 'Kv');
  lastfm(() =>
    recent([{ ...track, name: 'Fails', artist: { '#text': 'Kv' }, album: { '#text': 'Broken' } }]),
  );
  const response = await get({ LASTFM_API_KEY: key, ARTWORK: kv });
  await Promise.all(waits);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), shared);
  assert.equal(
    (await response.json()).artwork,
    `https://coverartarchive.org/release/${id}/front-250`,
  );
  assert.equal(kv.gets.length, 1);
  assert.equal(kv.puts.length, 1);
  assert.deepEqual(warnings, []);
});

test('a stalled KV costs at most the 1.5 s wait, and the lookup still fills the cache', async () => {
  const id = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
  const value = { artist: 'Stuck', track: 'Hangs', album: 'Never' };
  // A KV that never settles, read or write.
  const kv = { get: () => new Promise<null>(() => {}), put: () => new Promise<void>(() => {}) };
  musicbrainz = () => release(id, 'Never', 'Stuck');
  lastfm(() =>
    recent([
      { ...track, name: 'Hangs', artist: { '#text': 'Stuck' }, album: { '#text': 'Never' } },
    ]),
  );
  const answered = get({ LASTFM_API_KEY: key, ARTWORK: kv });
  (await deadline()).fire();
  const response = await answered;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).artwork, null);
  // The lookup runs after the wait and still keeps the artwork for the next answer.
  for (let turn = 0; turn < 200 && !store.has(artworkUrl(value)); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(
    await store.get(artworkUrl(value))?.clone().text(),
    `https://coverartarchive.org/release/${id}/front-250`,
  );
});

test('a KV that throws synchronously counts as a miss', async () => {
  const id = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
  const kv = {
    get: () => {
      throw new TypeError('key too long');
    },
    put: () => {
      throw new TypeError('key too long');
    },
  };
  musicbrainz = () => release(id, 'Thrown', 'Sync');
  lastfm(() =>
    recent([
      { ...track, name: 'Throws', artist: { '#text': 'Sync' }, album: { '#text': 'Thrown' } },
    ]),
  );
  const response = await get({ LASTFM_API_KEY: key, ARTWORK: kv });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).artwork,
    `https://coverartarchive.org/release/${id}/front-250`,
  );
});

test('a KV key over 512 bytes misses quietly, and the lookup answers', async () => {
  const id = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
  const title = 'é'.repeat(300);
  // A KV that rejects any key longer than its 512-byte limit, as Cloudflare's does.
  const kv = kvStore();
  const limited = {
    get: (name: string) =>
      new TextEncoder().encode(name).length > 512
        ? Promise.reject(new TypeError('key too long'))
        : kv.get(name),
    put: (name: string, url: string) =>
      new TextEncoder().encode(name).length > 512
        ? Promise.reject(new TypeError('key too long'))
        : kv.put(name, url),
  };
  musicbrainz = () => release(id, title, 'Long');
  lastfm(() =>
    recent([{ ...track, name: 'Wide', artist: { '#text': 'Long' }, album: { '#text': title } }]),
  );
  const response = await get({ LASTFM_API_KEY: key, ARTWORK: limited });
  await Promise.all(waits);
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).artwork,
    `https://coverartarchive.org/release/${id}/front-250`,
  );
  assert.equal(kv.data.size, 0);
});

test('the cache and KV puts both start, and neither holds the answer', async () => {
  const id = '9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
  const value = { artist: 'Both', track: 'Pending', album: 'Puts' };
  let cachePuts = 0;
  const stuck = {
    match: async () => undefined,
    put: () => {
      cachePuts++;
      return new Promise(() => {});
    },
  } as unknown as Cache;
  const kvPuts: string[] = [];
  const kv = {
    get: async () => null,
    put: (name: string) => {
      kvPuts.push(name);
      return new Promise<void>(() => {});
    },
  };
  musicbrainz = () => release(id, 'Puts', 'Both');
  lastfm(() =>
    recent([
      { ...track, name: 'Pending', artist: { '#text': 'Both' }, album: { '#text': 'Puts' } },
    ]),
  );
  const response = await get({ LASTFM_API_KEY: key, ARTWORK: kv }, undefined, stuck);
  assert.equal(
    (await response.json()).artwork,
    `https://coverartarchive.org/release/${id}/front-250`,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The artwork entry and the KV entry are both being written; the answer's own put is the third.
  assert.equal(cachePuts, 2);
  assert.deepEqual(kvPuts, [kvName(value)]);
  // A KV hit's refill of a stuck cache never holds the answer either.
  const hit = kvStore([[kvName(value), 'https://coverartarchive.org/release/x/front-250']]);
  const again = await get({ LASTFM_API_KEY: key, ARTWORK: hit }, undefined, stuck);
  assert.equal((await again.json()).artwork, 'https://coverartarchive.org/release/x/front-250');
});

// Any other export (onRequest, onRequestPost) would make Pages answer more than GET.
test('exports only the GET handler', async () => {
  const handlers = Object.keys(await import('./now-playing')).filter((name) =>
    name.startsWith('onRequest'),
  );
  assert.deepEqual(handlers, ['onRequestGet']);
});
