import { artworkKey, getArtwork } from '../../src/data/artwork';
import { type NowPlaying, recentTracks, toNowPlaying } from '../../src/data/now-playing';

// Workers add `default` to the global CacheStorage; this module is its only user.
declare const caches: CacheStorage & { default: Cache };

// LASTFM_API_KEY: set, encrypted, in both Pages environments; `wrangler pages dev` reads a
// gitignored .env. ARTWORK: an optional KV namespace binding; `wrangler pages dev --kv ARTWORK`
// simulates it.
interface Env {
  LASTFM_API_KEY?: string;
  ARTWORK?: Kv;
}

// The part of a KV namespace the Function uses.
interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

// The part of the Pages context the Function uses.
interface Context {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

// _headers never reaches a Function's response, so it sets its own.
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
};
// Browsers ask again each poll; the Cache API keeps a successful answer for 30 s per data centre.
const shared = 'public, max-age=0, s-maxage=30';
const month = { headers: { 'Cache-Control': 'public, max-age=2592000' } };

export const onRequestGet = (context: Context) => handle(context, caches.default);

// GET /api/now-playing: the owner's latest Last.fm track in the committed snapshot's shape. Any
// failure answers 200 null with no-store, never a 5xx. Only the request's origin is read, so no
// query string or visitor header reaches Last.fm. A failing Cache API, as it may be behind Access
// on previews, counts as a miss: the answer never depends on the cache.
export async function handle(context: Context, cache: Cache): Promise<Response> {
  const origin = new URL(context.request.url).origin;
  const key = `${origin}/api/now-playing`;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('X-Cache', 'hit');
    return response;
  }
  const value = await load(context.env.LASTFM_API_KEY);
  const body = value && (await withArtwork(value, context, cache, origin));
  const response = Response.json(body, {
    headers: { ...headers, 'Cache-Control': body ? shared : 'no-store', 'X-Cache': 'miss' },
  });
  if (body) {
    // A failed put only means the next request is a miss.
    context.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  }
  return response;
}

async function load(key: string | undefined): Promise<NowPlaying | null> {
  if (!key) {
    return fail('no LASTFM_API_KEY');
  }
  try {
    // 2.5 s for the request and its body: with the 1.5 s artwork wait, under the hub's 5 s.
    const response = await fetch(recentTracks(key), { signal: AbortSignal.timeout(2_500) });
    const value = response.ok ? toNowPlaying(await response.json()) : null;
    return value ?? fail(response.ok ? 'unexpected body' : `HTTP ${response.status}`);
  } catch (error) {
    // The name only: a fetch error's message can quote the URL, and with it the key.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

// The artwork URL from this data centre's Cache API (30 days), then from the ARTWORK KV namespace
// when it is bound (every data centre and preview, no expiry), or from a lookup. A slower lookup
// finishes after the answer and is kept in both for the next one; artwork.ts keeps misses in memory
// while the Worker instance lives.
async function withArtwork(value: NowPlaying, context: Context, cache: Cache, origin: string) {
  if (value.state === 'empty') {
    return { ...value, artwork: null };
  }
  const key = `${origin}/api/now-playing/artwork?k=${encodeURIComponent(artworkKey(value))}`;
  const stored = await cache
    .match(key)
    .then((entry) => entry?.text())
    .catch(() => undefined);
  if (stored) {
    return { ...value, artwork: stored };
  }
  // One 1.5 s wait covers the KV read and the lookup, so neither can hold the answer.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, 1_500, null);
  });
  // A failing or slow KV, or a key over KV's 512 bytes, counts as a miss; async functions turn even
  // a synchronous throw into a rejection, which each caller catches.
  const kv = context.env.ARTWORK;
  const name = `artwork:${artworkKey(value)}`;
  const read = async () => (kv ? kv.get(name) : null);
  const write = async (url: string) => kv?.put(name, url);
  const kept = await Promise.race([read().catch(() => null), late]);
  if (kept) {
    clearTimeout(timer);
    // Refill this data centre's cache, so its next miss skips KV.
    context.waitUntil(cache.put(key, new Response(kept, month)).catch(() => {}));
    return { ...value, artwork: kept };
  }
  // The answer races the lookup alone; storing its result happens after, under waitUntil.
  const lookup = getArtwork(value);
  context.waitUntil(
    lookup.then(async (url) => {
      if (url) {
        // A failed put only means a later answer looks the artwork up again.
        await Promise.all([
          cache.put(key, new Response(url, month)).catch(() => {}),
          write(url).catch(() => {}),
        ]);
      }
    }),
  );
  const artwork = await Promise.race([lookup, late]);
  clearTimeout(timer);
  return { ...value, artwork };
}

function fail(reason: string) {
  console.warn(`now-playing: no value from Last.fm (${reason})`);
  return null;
}
