import { type NowPlaying, recentTracks, toNowPlaying } from '../../src/data/now-playing';
import { read } from '../answer';

// The owner's latest Last.fm track in the committed snapshot's shape, without artwork, or the
// reason there is none, safe to log; it never logs. `key` is LASTFM_API_KEY. One `ms` budget covers
// the request and its body; src/data/lastfm.ts allows 5 s.
export async function fetchNowPlaying(
  key: string | undefined,
  ms: number,
): Promise<NowPlaying | string> {
  if (!key) {
    return 'no LASTFM_API_KEY';
  }
  try {
    const response = await fetch(recentTracks(key), { signal: AbortSignal.timeout(ms) });
    if (!response.ok) {
      return `HTTP ${response.status}`;
    }
    return toNowPlaying(JSON.parse(await read(response, 65_536))) ?? 'unexpected body';
  } catch (error) {
    // The name only: a fetch error's message can quote the URL, and with it the key.
    return error instanceof Error ? error.name : 'unknown error';
  }
}

// /api/now-playing's value, or null when Last.fm gives none, within 2.5 s: with the 1.5 s artwork
// wait, under the hub's 5 s.
export async function load(key: string | undefined): Promise<NowPlaying | null> {
  const value = await fetchNowPlaying(key, 2_500);
  if (typeof value !== 'string') {
    return value;
  }
  console.warn(`now-playing: no value from Last.fm (${value})`);
  return null;
}
