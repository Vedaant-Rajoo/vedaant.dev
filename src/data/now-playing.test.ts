import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromLive, shownAlbum, toNowPlaying, toOnRepeat, topAlbums } from './now-playing';
import snapshot from './snapshots/lastfm.json';

const now = Date.parse('2026-10-14T09:30:59Z');
const scrobble = {
  name: 'Song',
  artist: { '#text': 'Band' },
  album: { '#text': 'Record' },
  url: 'https://www.last.fm/music/Band/_/Song',
  date: { uts: '1760425439' },
};
const recent = (track: unknown) => ({ recenttracks: { track } });

test('live when nowplaying is "true", at the minute it was seen', () => {
  const { date: _, ...playing } = scrobble;
  const body = recent([{ ...playing, '@attr': { nowplaying: 'true' } }, scrobble]);
  assert.deepEqual(toNowPlaying(body, now), {
    state: 'live',
    track: 'Song',
    artist: 'Band',
    album: 'Record',
    at: '2026-10-14T09:30:00.000Z',
    url: 'https://www.last.fm/music/Band/_/Song',
  });
});

test('idle with at coarsened to the minute, for a list or a single track', () => {
  for (const body of [recent([scrobble]), recent(scrobble)]) {
    const value = toNowPlaying(body, now);
    assert.equal(value?.state, 'idle');
    assert.equal(value?.at, '2025-10-14T07:03:00.000Z');
  }
});

test('empty when there is no track', () => {
  assert.deepEqual(toNowPlaying(recent([]), now), {
    state: 'empty',
    track: null,
    artist: null,
    album: null,
    at: null,
    url: null,
  });
});

test('null for a malformed body', () => {
  const { date: _, ...undated } = scrobble;
  for (const body of [
    null,
    'x',
    {},
    { error: 10, message: 'Invalid API key' },
    recent([null]),
    recent([undefined]),
    recent([{ ...scrobble, name: 1 }]),
    recent([undated]),
    ...['Infinity', '-1', '1e20', true, { toString: null }].map((uts) =>
      recent([{ ...scrobble, date: { uts } }]),
    ),
  ]) {
    assert.equal(toNowPlaying(body, now), null);
  }
});

test('track drops a featured-artist credit in brackets', () => {
  const track = (name: string) => toNowPlaying(recent([{ ...scrobble, name }]), now)?.track;
  for (const name of [
    'Song (feat. A)',
    'Song (Feat. A & B)',
    'Song [ft. A]',
    'Song (ft A)',
    'Song (featuring A)',
  ]) {
    assert.equal(track(name), 'Song');
  }
  assert.equal(track('Song (feat. A) - Remix'), 'Song - Remix');
  assert.equal(track('Song (Remix) [feat. A]'), 'Song (Remix)');
  for (const name of ['Song (feature film)', 'Song (Soft)', 'Song feat. A', 'Left (Ftw)']) {
    assert.equal(track(name), name);
  }
});

test('url is a normalized https link to www.last.fm without credentials', () => {
  const url = (value: string) => toNowPlaying(recent([{ ...scrobble, url: value }]), now)?.url;
  assert.equal(url(' https://www.last.fm/music/Band/_/Song\n'), scrobble.url);
  for (const value of [
    'https://',
    'https://%',
    'http://www.last.fm/music/Band/_/Song',
    'javascript:alert(1)',
    'https://example.com/music/Band/_/Song',
    'https://www.last.fm.example.com/music/Band/_/Song',
    'https://user:pass@www.last.fm/music/Band/_/Song',
    'https://user@www.last.fm/music/Band/_/Song',
  ]) {
    assert.equal(url(value), null);
  }
});

// The snapshot is the build's fallback: rebuilt as a Last.fm body, it must map back to itself.
test('the committed snapshot is an idle value the mapping would produce', () => {
  const body = recent({
    name: snapshot.track,
    artist: { '#text': snapshot.artist },
    album: { '#text': snapshot.album ?? '' },
    url: snapshot.url,
    date: { uts: String(Date.parse(snapshot.at) / 1000) },
  });
  assert.equal(snapshot.state, 'idle');
  const { artwork: _, ...track } = snapshot;
  assert.deepEqual(toNowPlaying(body, now), track);
});

test('shownAlbum drops an album named as its track', () => {
  const value = toNowPlaying(recent([scrobble]), now);
  assert.equal(value && shownAlbum(value), 'Record');
  const single = toNowPlaying(recent([{ ...scrobble, album: { '#text': 'Song' } }]), now);
  assert.equal(single && shownAlbum(single), null);
});

test('fromLive keeps a body in the snapshot shape, the committed snapshot included', () => {
  assert.deepEqual(fromLive(snapshot), snapshot);
  const live = toNowPlaying(recent([{ ...scrobble, '@attr': { nowplaying: 'true' } }]), now);
  assert.ok(live);
  assert.deepEqual(fromLive({ ...live, artwork: null }), { ...live, artwork: null });
  const empty = { state: 'empty', track: null, artist: null, album: null, at: null, url: null };
  assert.deepEqual(fromLive({ ...empty, artwork: null }), { ...empty, artwork: null });
  // Extra fields are dropped, never passed on.
  assert.deepEqual(fromLive({ ...snapshot, extra: '<b>' }), snapshot);
  // artwork.ts accepts a release id in either case and keeps it in the URL.
  const upper = {
    ...snapshot,
    artwork: 'https://coverartarchive.org/release/391FEB5B-ED43-459B-ADFE-F7AE874175FE/front-250',
  };
  assert.deepEqual(fromLive(upper), upper);
});

test('fromLive rejects anything else, so the hub treats it as a failure', () => {
  const art = (artwork: unknown) => ({ ...snapshot, artwork });
  for (const body of [
    null,
    'x',
    [],
    {},
    { ...snapshot, state: 'offline' },
    { ...snapshot, state: 'loading' },
    { ...snapshot, track: 1 },
    { ...snapshot, album: undefined },
    { ...snapshot, at: '2026-10-13T21:49:30.000Z' },
    { ...snapshot, at: '2026-10-13T21:49:00Z' },
    { ...snapshot, at: '2026-13-13T21:49:00.000Z' },
    { ...snapshot, at: 1760425439 },
    { ...snapshot, url: 'http://www.last.fm/music/SHINee/_/Married+to+the+Music' },
    { ...snapshot, url: 'https://example.com/music/SHINee' },
    { ...snapshot, url: 'https://user@www.last.fm/music/SHINee' },
    { ...snapshot, url: 'javascript:alert(1)' },
    art(undefined),
    art('https://example.com/release/391feb5b-ed43-459b-adfe-f7ae874175fe/front-250'),
    art('http://coverartarchive.org/release/391feb5b-ed43-459b-adfe-f7ae874175fe/front-250'),
    art('https://coverartarchive.org/release/391feb5b-ed43-459b-adfe-f7ae874175fe/front-500'),
    art('https://coverartarchive.org/release/not-a-uuid/front-250'),
    art('https://coverartarchive.org/release/391feb5b-ed43-459b-adfe-f7ae874175fe/front-250?x=1'),
    art(
      'https://example.com/?https://coverartarchive.org/release/391feb5b-ed43-459b-adfe-f7ae874175fe/front-250',
    ),
  ]) {
    assert.equal(fromLive(body), null, JSON.stringify(body));
  }
});

// user.getTopAlbums, as Last.fm answers it, trimmed to what toOnRepeat reads.
const week = (album: unknown) => ({ topalbums: { album, '@attr': { user: 'newedia' } } });
const top = { name: 'UNFORGIVEN', playcount: '9', artist: { name: 'LE SSERAFIM' }, mbid: '' };

test('toOnRepeat maps the week top album to the shelf row', () => {
  assert.deepEqual(toOnRepeat(week([top])), {
    title: 'UNFORGIVEN',
    creator: 'LE SSERAFIM',
    plays: 9,
  });
  // One album may come as an object, not a list.
  assert.deepEqual(toOnRepeat(week(top)), {
    title: 'UNFORGIVEN',
    creator: 'LE SSERAFIM',
    plays: 9,
  });
  assert.deepEqual(toOnRepeat(week([{ ...top, playcount: 1 }]))?.plays, 1);
});

test('toOnRepeat: a week with no plays leaves the row out; anything malformed is null', () => {
  assert.equal(toOnRepeat(week([])), undefined);
  for (const body of [
    null,
    {},
    { topalbums: {} },
    week([{ ...top, name: '' }]),
    week([{ ...top, name: '  ' }]),
    week([{ ...top, artist: {} }]),
    week([{ ...top, playcount: '0' }]),
    week([{ ...top, playcount: '2.5' }]),
    week([{ ...top, playcount: 'many' }]),
    week([{ ...top, playcount: true }]),
    week([{ ...top, playcount: [9] }]),
    week([{ ...top, playcount: '9007199254740993' }]),
    week([null]),
  ]) {
    assert.equal(toOnRepeat(body), null, JSON.stringify(body));
  }
});

test('topAlbums asks for the last 7 days, one album, as JSON, with the given key', () => {
  const url = new URL(topAlbums('test-key'));
  assert.equal(url.origin + url.pathname, 'https://ws.audioscrobbler.com/2.0/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    method: 'user.gettopalbums',
    user: 'newedia',
    period: '7day',
    limit: '1',
    format: 'json',
    api_key: 'test-key',
  });
});
