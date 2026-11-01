import { type LastWatched, letterboxd, toLastWatched } from '../../src/data/shelf-live';
import { read } from '../answer';

// /api/activity's lastWatched row: the latest film in the owner's public Letterboxd diary, in
// shelf.json's `lastWatched` shape, or null as the row when the diary has none; null for no answer.
// The feed needs no key.
export async function load(): Promise<{ lastWatched: LastWatched | null } | null> {
  try {
    // 3 s for the request and its body, under the hub's 5 s; the feed is about 50 entries.
    const response = await fetch(letterboxd, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) {
      return fail(`HTTP ${response.status}`);
    }
    const value = toLastWatched(await read(response, 1_048_576));
    return value === null ? fail('unexpected body') : { lastWatched: value ?? null };
  } catch (error) {
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`last-watched: no value from Letterboxd (${reason})`);
  return null;
}
