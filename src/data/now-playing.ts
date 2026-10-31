export interface NowPlaying {
  state: 'live' | 'idle' | 'empty';
  track: string | null;
  artist: string | null;
  album: string | null;
  at: string | null;
  url: string | null;
  artwork?: string | null;
}

// user.getRecentTracks needs a key but no authentication. The build and the Function each pass
// the LASTFM_API_KEY from their host's environment; the hub reads /api/now-playing and has no key.
const user = 'newedia';

// The request for one key.
export const recentTracks = (key: string) =>
  `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({
    method: 'user.getrecenttracks',
    user,
    limit: '1',
    format: 'json',
    api_key: key,
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

// The song alone: Last.fm keeps a featured artist in the title, "Song (feat. X)" or "Song [ft. X]".
// shortcut: one bracket level; "(feat. A (B))" leaves a stray ")". Add a rule here per new pattern.
const song = (value: unknown) =>
  text(
    typeof value === 'string'
      ? value.replace(/\s*[([](?:feat(?:uring)?|ft)\b\.?[^)\]]*[)\]]/gi, '')
      : value,
  );

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
  const track = song(first?.name);
  const artist = text(first?.artist?.['#text']);
  if (!first || track === null || artist === null) {
    return null;
  }
  const live = first['@attr']?.nowplaying === 'true';
  const uts = first.date?.uts;
  const seconds = typeof uts === 'string' || typeof uts === 'number' ? Number(uts) : Number.NaN;
  // Coarsened to the minute, for privacy; an invalid date when the time is unusable.
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

const states = new Set<unknown>(['live', 'idle', 'empty']);
const cover =
  /^https:\/\/coverartarchive\.org\/release\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/front-250$/i;
const optional = (value: unknown) => value === null || typeof value === 'string';
// A whole minute, written as toNowPlaying writes it.
const minute = (value: unknown) => {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return time % 60_000 === 0 && new Date(time).toISOString() === value;
};

// Checks a parsed /api/now-playing body: the committed snapshot's seven fields and nothing else,
// each in the form the Function writes; null for anything else, so the hub treats it as a failure.
// The link must pass page() unchanged and the artwork must be a Cover Art Archive thumbnail, because
// they end up in an href and an <img src>.
export function fromLive(body: unknown): NowPlaying | null {
  const { state, track, artist, album, at, url, artwork } = (body ?? {}) as Record<string, unknown>;
  const valid =
    typeof body === 'object' &&
    states.has(state) &&
    [track, artist, album].every(optional) &&
    (at === null || minute(at)) &&
    (url === null || (typeof url === 'string' && page(url) === url)) &&
    (artwork === null || (typeof artwork === 'string' && cover.test(artwork)));
  return valid ? ({ state, track, artist, album, at, url, artwork } as NowPlaying) : null;
}

// The album the music row and the /now cell show beside the artist: none when it is named as the
// track, as a single's is, so the name is not read twice.
export const shownAlbum = ({ track, album }: NowPlaying) => (album === track ? null : album);

// The age the music widgets show. Under a minute, or ahead of the clock, reads "1m ago".
export function ago(time: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(time)) / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return days < 365 ? `${days}d ago` : `${Math.floor(days / 365)}y ago`;
}

// The text of the music row and the /now cell, at build and in the hub. Artist and album each sit
// between U+2068 and U+2069, so a right-to-left name reorders neither the other nor the separators,
// and a closing space sets the text apart from the time. The /now cell starts the artist on a line
// of its own, so only the row passes a separator as the lead.
export function nowPlayingText(state: string, value: NowPlaying, lead: string) {
  const { track, artist, at } = value;
  const album = shownAlbum(value);
  const after = album ? ` · \u2068${album}\u2069` : '';
  const rest = artist ? `${lead}\u2068${artist}\u2069${after} ` : '';
  const time = state === 'live' ? 'now' : (at && ago(at)) || '';
  return { track: track ?? '—', rest, time };
}

// The hero's presence line: no track reads empty, and live without an artist reads idle.
export function presenceState(state: string, { track, artist }: NowPlaying) {
  if (!track?.trim()) {
    return 'empty';
  }
  return state === 'live' && !artist?.trim() ? 'idle' : state;
}

export function presenceText(state: string, { track, artist }: NowPlaying) {
  const shown = state !== 'empty' && state !== 'loading';
  const live = state === 'live';
  const idle = shown ? 'not listening — last: ' : '—';
  return {
    state: live ? 'listening — ' : idle,
    track: shown ? (track ?? '') : '',
    artist: live ? ` · \u2068${artist}\u2069` : '',
  };
}
