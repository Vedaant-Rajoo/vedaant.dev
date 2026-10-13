import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toNowPlaying } from './now-playing';
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

// The snapshot is S21a's fallback: rebuilt as a Last.fm body, it must map back to itself.
test('the committed snapshot is an idle value the mapping would produce', () => {
  const body = recent({
    name: snapshot.track,
    artist: { '#text': snapshot.artist },
    album: { '#text': snapshot.album ?? '' },
    url: snapshot.url,
    date: { uts: String(Date.parse(snapshot.at) / 1000) },
  });
  assert.equal(snapshot.state, 'idle');
  assert.deepEqual(toNowPlaying(body, now), snapshot);
});
