import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkKey, getArtwork } from './artwork';
import type { NowPlaying } from './now-playing';

test('artwork validates matches, prefers the album, caches requests and fails closed', {
  timeout: 20_000,
}, async () => {
  const original = globalThis.fetch;
  const ids = [
    '391feb5b-ed43-459b-adfe-f7ae874175fe',
    '20650fa6-385c-44c6-a12a-31a513589858',
    '2453aee5-6f3e-4674-97b7-7ba611f37382',
  ];
  const value: NowPlaying = {
    state: 'idle',
    track: 'Song',
    artist: 'Band',
    album: 'Record',
    at: null,
    url: null,
  };
  const credited = [{ name: 'Band' }];
  let calls = 0;
  const searches: number[] = [];
  const covers: string[] = [];
  let fail = false;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.ok(init?.signal);
    if (url.hostname === 'musicbrainz.org') {
      searches.push(Date.now());
      if (fail) {
        throw new TypeError('offline');
      }
      assert.equal(url.pathname, '/ws/2/release/');
      assert.ok(url.searchParams.get('query')?.startsWith('release:'));
      if (url.searchParams.get('query') === 'release:"Song" AND artist:"Band"') {
        return Response.json({
          releases: [{ id: ids[0], title: 'Song', 'artist-credit': credited }],
        });
      }
      return Response.json({
        releases: [
          null,
          { id: ids[0], title: 'Different record', 'artist-credit': credited },
          { id: ids[0], title: 'Record', 'artist-credit': [{ name: 'Other band' }] },
          { id: ids[0], title: 'Record', 'artist-credit': 'Band' },
          { id: 'https://example.com/bad', title: 'Record', 'artist-credit': credited },
          ...[ids[1], ids[1], ids[2]].map((id) => ({
            id,
            title: 'Record',
            'artist-credit': credited,
          })),
        ],
      });
    }
    assert.equal(url.hostname, 'coverartarchive.org');
    assert.equal(init?.method, 'HEAD');
    covers.push(url.pathname);
    if (url.pathname.includes(ids[1])) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, {
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '12000' },
    });
  };
  try {
    assert.equal(await getArtwork({ ...value, track: null }), null);
    assert.equal(await getArtwork({ ...value, artist: '---' }), null);
    assert.equal(calls, 0);
    const first = getArtwork(value);
    assert.equal(first, getArtwork({ ...value }));
    assert.equal(await first, `https://coverartarchive.org/release/${ids[2]}/front-250`);
    assert.deepEqual(covers, [`/release/${ids[1]}/front-250`, `/release/${ids[2]}/front-250`]);
    assert.equal(await getArtwork(value), await first);
    assert.equal(calls, 3);
    assert.notEqual(artworkKey(value), artworkKey({ ...value, album: 'Other album' }));
    assert.equal(await getArtwork({ ...value, album: 'Record - Deluxe' }), await first);
    assert.equal(calls, 6);
    assert.equal(
      await getArtwork({ ...value, album: 'Missing' }),
      `https://coverartarchive.org/release/${ids[0]}/front-250`,
    );
    assert.equal(calls, 9);

    fail = true;
    assert.equal(await getArtwork({ ...value, album: 'Offline' }), null);
    assert.equal(await getArtwork({ ...value, album: 'Offline' }), null);
    assert.equal(calls, 10);
    for (let i = 1; i < searches.length; i++) {
      assert.ok(searches[i] - searches[i - 1] >= 1090);
    }
    fail = false;

    // A valid response containing no usable artwork must still return the glyph fallback.
    globalThis.fetch = async () => Response.json({ releases: {} });
    assert.equal(await getArtwork({ ...value, album: 'Malformed' }), null);
    let title = 'Large cover';
    const headers = new Headers({ 'Content-Type': 'image/jpeg', 'Content-Length': '33522' });
    globalThis.fetch = async (input) => {
      if (String(input).includes('musicbrainz.org')) {
        return Response.json({
          releases: [{ id: ids[0], title, 'artist-credit': credited }],
        });
      }
      return new Response(null, { headers });
    };
    const artwork = `https://coverartarchive.org/release/${ids[0]}/front-250`;
    assert.equal(await getArtwork({ ...value, album: title }), artwork);
    title = 'Unknown size';
    headers.delete('Content-Length');
    assert.equal(await getArtwork({ ...value, album: title }), artwork);
    title = 'Not an image';
    headers.set('Content-Type', 'text/html');
    assert.equal(await getArtwork({ ...value, album: title }), null);

    let escapedQuery: string | null = null;
    globalThis.fetch = async (input) => {
      escapedQuery = new URL(String(input)).searchParams.get('query');
      return Response.json({ releases: [] });
    };
    assert.equal(
      await getArtwork({ ...value, album: null, track: 'Song " OR *', artist: 'Band\\name' }),
      null,
    );
    assert.equal(escapedQuery, 'release:"Song \\" OR *" AND artist:"Band\\\\name"');
  } finally {
    globalThis.fetch = original;
  }
});
