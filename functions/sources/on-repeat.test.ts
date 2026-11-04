import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { topAlbums } from '../../src/data/now-playing';
import { load } from './on-repeat';

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
  for (const [answer, reason] of cases) {
    lastfmAnswers(answer);
    assert.equal(await load(key), null);
    assert.equal(warnings.at(-1), `on-repeat: no value from Last.fm (${reason})`);
  }
  assert.doesNotMatch(warnings.join('\n'), new RegExp(key));
});
