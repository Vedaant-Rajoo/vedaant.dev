import { LASTFM_API_KEY } from 'astro:env/server';
import { type OnRepeat, toOnRepeat, topAlbums } from './now-playing';
import { shelf } from './shelf';

// /shelf's on-repeat row: the week's most played album from Last.fm when the site is built, read
// with the same key as lastfm.ts. Without the key, or on failure, it is shelf.json's `listening`
// row, with one `shelf:` warning; a week with no plays leaves the row out. Nothing builds on a
// schedule, so the row is as fresh as the last build.
async function load(): Promise<OnRepeat | undefined> {
  let reason = 'no LASTFM_API_KEY';
  try {
    if (LASTFM_API_KEY) {
      // One 5 s budget for the whole request, its body included.
      const response = await fetch(topAlbums(LASTFM_API_KEY), {
        signal: AbortSignal.timeout(5_000),
      });
      const value = response.ok ? toOnRepeat(await response.json()) : null;
      if (value !== null) {
        return value;
      }
      reason = response.ok ? 'unexpected body' : `HTTP ${response.status}`;
    }
  } catch (error) {
    // The name only: a JSON error's message quotes the body, line breaks included.
    reason = error instanceof Error ? error.name : 'unknown error';
  }
  console.warn(`shelf: no on-repeat album from Last.fm (${reason}); using shelf.json`);
  return shelf.listening;
}

export const onRepeat = await load();
