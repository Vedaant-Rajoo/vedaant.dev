import { type OnRepeat, toOnRepeat, topAlbums } from '../../src/data/now-playing';
import { read } from '../answer';

// /api/activity's listening row: the owner's most played album of the last 7 days on Last.fm, in
// shelf.json's `listening` shape, or null as the row for a week with no plays; null for no answer.
// `key` is LASTFM_API_KEY, the key /api/now-playing reads. This module exports no onRequest handler,
// so it is no route.
export async function load(
  key: string | undefined,
): Promise<{ listening: OnRepeat | null } | null> {
  if (!key) {
    return fail('no LASTFM_API_KEY');
  }
  try {
    // 2.5 s for the request and its body, as /api/now-playing allows.
    const response = await fetch(topAlbums(key), { signal: AbortSignal.timeout(2_500) });
    if (!response.ok) {
      return fail(`HTTP ${response.status}`);
    }
    const value = toOnRepeat(JSON.parse(await read(response, 65_536)));
    return value === null ? fail('unexpected body') : { listening: value ?? null };
  } catch (error) {
    // The name only: a fetch error's message can quote the URL, and with it the key.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`on-repeat: no value from Last.fm (${reason})`);
  return null;
}
