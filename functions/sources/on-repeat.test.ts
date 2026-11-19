import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { topAlbums } from '../../src/data/now-playing';
import { fetchOnRepeat, load } from './on-repeat';

const key = 'lastfm-test-key';
const original = { fetch: globalThis.fetch, warn: console.warn, timeout: AbortSignal.timeout };
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];

const week = (album: unknown) => Response.json({ topalbums: { album } });
const top = { name: 'UNFORGIVEN', playcount: '9', artist: { name: 'LE SSERAFIM' } };

function lastfmAnswers(answer: () => Response | Promise<Response>) {
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return answer();
  };
}

beforeEach(() => {
  requests = [];
  warnings = [];
  console.warn = (message: string) => warnings.push(message);
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  console.warn = original.warn;
  AbortSignal.timeout = original.timeout;
});

test("loads the week's top album as the listening row", async () => {
  lastfmAnswers(() => week([top]));
  assert.deepEqual(await load(key), {
    listening: { title: 'UNFORGIVEN', creator: 'LE SSERAFIM', plays: 9 },
  });
});

test('asks Last.fm for the top album with the key alone, within 2.5 s', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  lastfmAnswers(() => week([top]));
  await load(key);
  assert.deepEqual(budgets, [2_500]);
  assert.deepEqual(
    requests.map(({ url, init }) => [url, Object.keys(init ?? {})]),
    [[topAlbums(key), ['signal']]],
  );
});

test('a week with no plays is a value: a null row', async () => {
  lastfmAnswers(() => week([]));
  assert.deepEqual(await load(key), { listening: null });
});

// src/data/on-repeat.ts reads Last.fm through fetchOnRepeat, then logs its own line and falls back
// to shelf.json's row, so the reader returns the reason and logs nothing.
test('fetchOnRepeat uses a 5,000 ms budget and returns safe reasons without logging', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  lastfmAnswers(() => week([top]));
  assert.deepEqual(await fetchOnRepeat(key, 5_000), {
    title: 'UNFORGIVEN',
    creator: 'LE SSERAFIM',
    plays: 9,
  });
  assert.deepEqual(budgets, [5_000]);
  // A week with no plays is a value, not a reason: the build shows "—", not shelf.json's row.
  lastfmAnswers(() => week([]));
  assert.equal(await fetchOnRepeat(key, 5_000), undefined);
  // The load tests below pin each reason; these check the limit edge, silence and a safe name.
  lastfmAnswers(() => new Response(`"${'x'.repeat(65_536)}"`));
  assert.equal(await fetchOnRepeat(key, 5_000), 'RangeError');
  lastfmAnswers(() => {
    throw new TypeError(`fetch failed for ${topAlbums(key)}`);
  });
  assert.equal(await fetchOnRepeat(key, 5_000), 'TypeError');
  assert.equal(await fetchOnRepeat(undefined, 5_000), 'no LASTFM_API_KEY');
  assert.deepEqual(warnings, []);
});

test('a missing key is no value, and Last.fm is not asked', async () => {
  assert.equal(await load(undefined), null);
  assert.equal(requests.length, 0);
  assert.deepEqual(warnings, ['on-repeat: no value from Last.fm (no LASTFM_API_KEY)']);
});

test('an upstream error, a bad or oversized body, or a thrown fetch is no value', async () => {
  const cases: [() => Response, string][] = [
    [() => new Response('no', { status: 500 }), 'HTTP 500'],
    [() => Response.json({ error: 29, message: 'Rate limit exceeded' }), 'unexpected body'],
    [() => week([{ ...top, playcount: '0' }]), 'unexpected body'],
    [() => new Response('{'), 'SyntaxError'],
    [() => new Response(`"${'x'.repeat(70_000)}"`), 'RangeError'],
    [
      () => {
        throw new TypeError(`fetch failed for ${topAlbums(key)}`);
      },
      'TypeError',
    ],
  ];
  for (const [index, [answer, reason]] of cases.entries()) {
    lastfmAnswers(answer);
    assert.equal(await load(key), null);
    assert.equal(warnings.length, index + 1);
    assert.equal(warnings.at(-1), `on-repeat: no value from Last.fm (${reason})`);
  }
  assert.doesNotMatch(warnings.join('\n'), new RegExp(key));
});
