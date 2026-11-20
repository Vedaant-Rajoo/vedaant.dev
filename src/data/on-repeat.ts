import { LASTFM_API_KEY } from 'astro:env/server';
import { fetchOnRepeat } from '../../functions/sources/on-repeat';
import type { OnRepeat } from './now-playing';
import { shelf } from './shelf';

// /shelf's on-repeat row: the week's most played album from Last.fm when the site is built, read
// with the same key as lastfm.ts. Without the key, or on failure, it is shelf.json's `listening`
// row, with one `shelf:` warning; a week with no plays shows the row as "—". Nothing builds on a
// schedule, so the row is as fresh as the last build.
async function load(): Promise<OnRepeat | undefined> {
  const value = await fetchOnRepeat(LASTFM_API_KEY, 5_000);
  if (typeof value !== 'string') {
    return value;
  }
  console.warn(`shelf: no on-repeat album from Last.fm (${value}); using shelf.json`);
  return shelf.listening;
}

export const onRepeat = await load();
