// The owner's latest Last.fm track, as the now-playing row shows it: read at build (S21a) and in
// the browser (S24).
export interface NowPlaying {
  state: 'live' | 'idle' | 'empty';
  track: string | null;
  artist: string | null;
  album: string | null;
  at: string | null;
  url: string | null;
}

// user.getRecentTracks needs no authentication, and the key ships in the page (AGENTS.md, D92).
const user = 'newedia';
const apiKey = 'ad7d5f6085314e87eac8b6bc74a08ac2'; // gitleaks:allow: public and read-only (D92)

export const recentTracks = `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({
  method: 'user.getrecenttracks',
  user,
  limit: '1',
  format: 'json',
  api_key: apiKey,
})}`;

interface Track {
  name?: unknown;
  artist?: { '#text'?: unknown };
  album?: { '#text'?: unknown };
  url?: unknown;
  '@attr'?: { nowplaying?: unknown };
  date?: { uts?: unknown };
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

// The track's page on Last.fm, normalized; null unless it is an https URL on www.last.fm without
// credentials. It ends up in an href.
const page = (value: unknown) => {
  const raw = text(value);
  const url = raw !== null && URL.canParse(raw) ? new URL(raw) : null;
  const safe = url?.protocol === 'https:' && url.username === '' && url.password === '';
  return safe && url.host === 'www.last.fm' ? url.href : null;
};

// Maps a parsed user.getRecentTracks JSON body; null when the body is not one. A live track's
// `at` is when it was seen playing, so a build-time value can still say how long ago that was.
export function toNowPlaying(body: unknown, now = Date.now()): NowPlaying | null {
  const tracks = (body as { recenttracks?: { track?: unknown } } | null)?.recenttracks?.track;
  if (typeof tracks !== 'object' || tracks === null) {
    return null;
  }
  if (Array.isArray(tracks) && tracks.length === 0) {
    return { state: 'empty', track: null, artist: null, album: null, at: null, url: null };
  }
  const first = (Array.isArray(tracks) ? tracks[0] : tracks) as Track | null | undefined;
  const track = text(first?.name);
  const artist = text(first?.artist?.['#text']);
  if (!first || track === null || artist === null) {
    return null;
  }
  const live = first['@attr']?.nowplaying === 'true';
  // Last.fm sends a scrobble's Unix time in seconds, as a string.
  const uts = first.date?.uts;
  const seconds = typeof uts === 'string' || typeof uts === 'number' ? Number(uts) : Number.NaN;
  // Coarsened to the minute (FR-LV-5, NFR-X5); an invalid date when the time is unusable.
  const at = new Date(Math.floor((live ? now : seconds * 1000) / 60_000) * 60_000);
  if (!(live || seconds > 0) || Number.isNaN(at.getTime())) {
    return null;
  }
  return {
    state: live ? 'live' : 'idle',
    track,
    artist,
    album: text(first.album?.['#text']),
    at: at.toISOString(),
    url: page(first.url),
  };
}
