import { type NowPlaying, recentTracks, toNowPlaying } from '../../src/data/now-playing';

// Set, encrypted, in both Pages environments; `wrangler pages dev` reads a gitignored .env.
interface Env {
  LASTFM_API_KEY?: string;
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

// GET /api/now-playing: the owner's latest Last.fm track in the committed snapshot's shape. Any
// failure answers 200 null with no-store, never a 5xx. The request itself is never read, so no
// query string or visitor header reaches Last.fm.
export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  const value = await load(env.LASTFM_API_KEY);
  const cache = value ? 'public, max-age=0, s-maxage=30' : 'no-store';
  return Response.json(value, { headers: { ...headers, 'Cache-Control': cache } });
}

async function load(key: string | undefined): Promise<NowPlaying | null> {
  if (!key) {
    return fail('no LASTFM_API_KEY');
  }
  try {
    // 2.5 s for the request and its body, half the hub's 5 s budget.
    const response = await fetch(recentTracks(key), { signal: AbortSignal.timeout(2_500) });
    const value = response.ok ? toNowPlaying(await response.json()) : null;
    // shortcut: artwork is always null; the lookup comes with the Cache API that bounds its cost.
    if (value) {
      return { ...value, artwork: null };
    }
    return fail(response.ok ? 'unexpected body' : `HTTP ${response.status}`);
  } catch (error) {
    // The name only: a fetch error's message can quote the URL, and with it the key.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`now-playing: no value from Last.fm (${reason})`);
  return null;
}
