import { LASTFM_API_KEY } from 'astro:env/server';
import { fetchNowPlaying } from '../../functions/sources/now-playing';
import { getArtwork } from './artwork';
import type { NowPlaying } from './now-playing';
import snapshot from './snapshots/lastfm.json';

async function load(): Promise<NowPlaying> {
  const value = await fetchNowPlaying(LASTFM_API_KEY, 5_000);
  if (typeof value !== 'string') {
    // getArtwork never rejects: a failed lookup, or one past its own timeout, is a null artwork.
    return { ...value, artwork: await getArtwork(value) };
  }
  console.warn(`lastfm: no value from Last.fm (${value}); using the committed snapshot`);
  // The committed value, used when the key is unset, Last.fm fails or it sends a body the mapping
  // rejects, so the build needs no network. JSON gives `state` the type string, so only it is cast;
  // now-playing.test.ts proves the snapshot is an idle value toNowPlaying returns.
  return { ...snapshot, state: snapshot.state as NowPlaying['state'] };
}

// The owner's latest track when the site is built, for frontmatter only; the hub reads
// /api/now-playing. A module's top level runs once per build, so every page that imports this
// shares one request.
export const nowPlaying = await load();
