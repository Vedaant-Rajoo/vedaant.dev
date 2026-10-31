import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { letterboxd } from '../../src/data/shelf-live';
import { load } from './last-watched';

const original = { fetch: globalThis.fetch, warn: console.warn, timeout: AbortSignal.timeout };
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];

const feed = (items: string) =>
  new Response(`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`, {
    headers: { 'cache-control': 'no-store' },
  });
const film =
  '<item><letterboxd:watchedDate>2026-10-28</letterboxd:watchedDate><letterboxd:filmTitle>Clueless</letterboxd:filmTitle><letterboxd:filmYear>1995</letterboxd:filmYear><letterboxd:memberRating>3.5</letterboxd:memberRating></item>';

function letterboxdAnswers(answer: () => Response | Promise<Response>) {
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

test('loads the latest diary entry as the lastWatched row', async () => {
  letterboxdAnswers(() => feed(film));
  assert.deepEqual(await load(), {
    lastWatched: { title: 'Clueless', year: 1995, rating: 3.5, date: '2026-10-28' },
  });
});

test('asks for the public feed alone, within 3 s', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  letterboxdAnswers(() => feed(film));
  await load();
  assert.deepEqual(budgets, [3_000]);
  assert.deepEqual(
    requests.map(({ url, init }) => [url, Object.keys(init ?? {})]),
    [[letterboxd, ['signal']]],
  );
});

test('a diary with no entries is a value: a null row', async () => {
  letterboxdAnswers(() => feed(''));
  assert.deepEqual(await load(), { lastWatched: null });
});

test('an upstream error, a page that is not the feed, or an oversized body is no value', async () => {
  const cases: [() => Response, string][] = [
    [() => new Response('no', { status: 429 }), 'HTTP 429'],
    [() => new Response('<!DOCTYPE html><html></html>'), 'unexpected body'],
    [() => new Response('<rss><channel><item>'), 'unexpected body'],
    [() => new Response('<rss><channel/></rss>upstream error'), 'unexpected body'],
    [() => new Response('upstream error<rss><channel/></rss>'), 'unexpected body'],
    [
      () =>
        new Response(
          `<rss><channel>${'<x>'.repeat(50_000)}${'</x>'.repeat(50_000)}</channel></rss>`,
        ),
      'unexpected body',
    ],
    [() => new Response('<rss>'.padEnd(1_048_577, ' ')), 'RangeError'],
    [
      () => {
        throw new TypeError('network down');
      },
      'TypeError',
    ],
  ];
  for (const [answer, reason] of cases) {
    letterboxdAnswers(answer);
    assert.equal(await load(), null);
    assert.equal(warnings.at(-1), `last-watched: no value from Letterboxd (${reason})`);
  }
});
