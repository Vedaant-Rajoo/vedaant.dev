import { LASTFM_API_KEY } from 'astro:env/server';
import { getArtwork } from './artwork';
import { type NowPlaying, recentTracks, toNowPlaying } from './now-playing';
import snapshot from './snapshots/lastfm.json';

// The committed value, used when the key is unset, Last.fm fails or it sends a body the mapping
// rejects, so the build needs no network. JSON gives `state` the type string, so only it is cast;
// now-playing.test.ts proves the snapshot is an idle value toNowPlaying returns.
const fallback: NowPlaying = { ...snapshot, state: snapshot.state as NowPlaying['state'] };

async function load(): Promise<NowPlaying> {
  let reason = 'no LASTFM_API_KEY';
  try {
    if (LASTFM_API_KEY) {
      // One 5 s budget for the whole request, its body included.
      const response = await fetch(recentTracks(LASTFM_API_KEY), {
        signal: AbortSignal.timeout(5_000),
      });
      const value = response.ok ? toNowPlaying(await response.json()) : null;
      if (value) {
        return { ...value, artwork: await getArtwork(value) };
      }
      reason = response.ok ? 'unexpected body' : `HTTP ${response.status}`;
    }
  } catch (error) {
    // The name only: a JSON error's message quotes the body, line breaks included.
    reason = error instanceof Error ? error.name : 'unknown error';
  }
  console.warn(`lastfm: no value from Last.fm (${reason}); using the committed snapshot`);
  return fallback;
}

// The owner's latest track when the site is built, for frontmatter only; the hub reads
// /api/now-playing. A module's top level runs once per build, so every page that imports this
// shares one request.
export const nowPlaying = await load();
