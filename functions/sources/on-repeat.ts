import { type OnRepeat, toOnRepeat, topAlbums } from '../../src/data/now-playing';
import { read } from '../answer';

// The owner's most played album of the last 7 days on Last.fm, in shelf.json's `listening` shape,
// undefined for a week with no plays, or the reason there is none, safe to log; it never logs.
// `key` is LASTFM_API_KEY, the key /api/now-playing reads. One `ms` budget covers the request and
// its body; src/data/on-repeat.ts allows 5 s.
export async function fetchOnRepeat(
  key: string | undefined,
  ms: number,
): Promise<OnRepeat | undefined | string> {
  if (!key) {
    return 'no LASTFM_API_KEY';
  }
  try {
    const response = await fetch(topAlbums(key), { signal: AbortSignal.timeout(ms) });
    if (!response.ok) {
      return `HTTP ${response.status}`;
    }
    const value = toOnRepeat(JSON.parse(await read(response, 65_536)));
    return value === null ? 'unexpected body' : value;
  } catch (error) {
    // The name only: a fetch error's message can quote the URL, and with it the key.
    return error instanceof Error ? error.name : 'unknown error';
  }
}

// /api/activity's listening row, or null as the row for a week with no plays; null for no answer.
// 2.5 s, as /api/now-playing allows.
export async function load(
  key: string | undefined,
): Promise<{ listening: OnRepeat | null } | null> {
  const value = await fetchOnRepeat(key, 2_500);
  if (typeof value === 'string') {
    console.warn(`on-repeat: no value from Last.fm (${value})`);
    return null;
  }
  return { listening: value ?? null };
}
