import { WAKATIME_API_KEY } from 'astro:env/server';
import { fetchCoding } from '../../functions/sources/coding';
import type { Coding } from './coding';
import snapshot from './snapshots/wakatime.json';

async function load(): Promise<Coding> {
  const value = await fetchCoding(WAKATIME_API_KEY, 5_000);
  if (typeof value !== 'string') {
    return value;
  }
  console.warn(`wakatime: no value from WakaTime (${value}); using the committed snapshot`);
  // The committed value, used when the key is unset or WakaTime fails, so the build needs no
  // network. coding.test.ts proves the hub accepts it.
  return snapshot as Coding;
}

// The newest day of the last seven with coding when the site is built, for the /now cell's
// frontmatter; the hub reads /api/activity. A module's top level runs once per build, so every page
// that imports this shares one set of requests.
export const coding = await load();
