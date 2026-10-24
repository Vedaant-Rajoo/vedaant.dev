import type { NowPlaying } from './now-playing';

type Release = { id?: unknown; title?: unknown; 'artist-credit'?: { name?: unknown }[] };
const normalize = (text: unknown) =>
  typeof text === 'string'
    ? text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '')
    : '';
const quote = (text: string) => `"${text.replace(/["\\]/g, '\\$&')}"`;
const credited = (release: Release, artist: string) =>
  Array.isArray(release['artist-credit']) &&
  release['artist-credit'].some((credit) => normalize(credit?.name) === artist);

// shortcut: cache successes and misses for this page's lifetime; reload retries failed lookups.
const cache = new Map<string, Promise<string | null>>();
let due = 0;
let queue = Promise.resolve();

export const artworkKey = ({ artist, track, album }: NowPlaying) =>
  JSON.stringify([artist, track, album]);

export function getArtwork(value: NowPlaying): Promise<string | null> {
  if (!normalize(value.artist) || !normalize(value.track)) {
    return Promise.resolve(null);
  }
  const key = artworkKey(value);
  let pending = cache.get(key);
  if (!pending) {
    pending = queue.then(() => lookup(value)).catch(() => null);
    cache.set(key, pending);
    queue = pending.then(() => {});
  }
  return pending;
}

async function lookup(value: NowPlaying): Promise<string | null> {
  const signal = AbortSignal.timeout(12_000);
  const artist = normalize(value.artist);
  // shortcut: strip " - edition"; missing albums try the track's single, then keep the glyph.
  for (const title of new Set([value.album?.split(' - ')[0], value.track])) {
    if (!title?.trim()) {
      continue;
    }
    // MusicBrainz allows one request per second per IP. Serialize this page's searches.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, due - Date.now())));
    due = Date.now() + 1100;
    const query = `release:${quote(title)} AND artist:${quote(value.artist ?? '')}`;
    const response = await fetch(
      `https://musicbrainz.org/ws/2/release/?${new URLSearchParams({ query, fmt: 'json', limit: '10' })}`,
      {
        signal,
        headers:
          typeof window === 'undefined'
            ? { 'User-Agent': 'vedaant.dev/1.0 (https://vedaantrajoo.com)' }
            : undefined,
      },
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { releases?: Release[] } | null;
    const rows = body?.releases;
    const releases = (Array.isArray(rows) ? rows : []).filter(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.id) &&
        normalize(row.title) === normalize(title) &&
        credited(row, artist),
    );
    const artwork = await cover(releases, signal);
    if (artwork) {
      return artwork;
    }
  }
  return null;
}

async function cover(releases: Release[], signal: AbortSignal): Promise<string | null> {
  const ids = [...new Set(releases.map((release) => release.id))].slice(0, 3);
  for (const id of ids) {
    const url = `https://coverartarchive.org/release/${id}/front-250`;
    const image = await fetch(url, { method: 'HEAD', signal });
    // shortcut: use CAA's 250px thumbnail; add resizing if measured transfer costs warrant it.
    if (image.ok && image.headers.get('content-type')?.startsWith('image/')) {
      return url;
    }
  }
  return null;
}
