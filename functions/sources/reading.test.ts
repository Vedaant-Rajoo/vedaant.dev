import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { hardcover, readingQuery } from '../../src/data/shelf-live';
import { load } from './reading';

const token = 'hardcover-test-token';
const original = { fetch: globalThis.fetch, warn: console.warn, timeout: AbortSignal.timeout };
let requests: { url: string; init?: RequestInit }[];
let warnings: string[];

const book = {
  book: {
    title: 'A Game of Thrones',
    contributions: [{ contribution: null, author: { name: 'George R. R. Martin' } }],
  },
  user_book_reads: [{ started_at: '2026-10-03', progress_pages: 120 }],
};
const books = (...rows: unknown[]) => Response.json({ data: { user_books: rows } });

function hardcoverAnswers(answer: () => Response | Promise<Response>) {
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

test('loads the current book as the reading row', async () => {
  hardcoverAnswers(() => books(book));
  assert.deepEqual(await load(token), {
    reading: {
      title: 'A Game of Thrones',
      creator: 'George R. R. Martin',
      started: '2026-10',
      page: 120,
    },
  });
});

test('asks Hardcover with the token and the query alone, within 3 s', async () => {
  const budgets: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    budgets.push(ms);
    return original.timeout.call(AbortSignal, ms);
  };
  hardcoverAnswers(() => books(book));
  await load(token);
  assert.deepEqual(budgets, [3_000]);
  const [{ url, init }] = requests;
  assert.equal(url, hardcover);
  assert.equal(init?.method, 'POST');
  assert.deepEqual(init?.headers, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(init?.body)), { query: readingQuery });
  assert.ok(init?.signal instanceof AbortSignal);
});

test('no current book is a value: a null row', async () => {
  hardcoverAnswers(() => books());
  assert.deepEqual(await load(token), { reading: null });
});

test('a missing token is no value, and Hardcover is not asked', async () => {
  for (const missing of [undefined, '']) {
    assert.equal(await load(missing), null);
  }
  assert.equal(requests.length, 0);
  assert.equal(warnings.at(-1), 'reading: no value from Hardcover (no HARDCOVER_TOKEN)');
});

test('an upstream error, GraphQL errors, a bad or oversized body are no value', async () => {
  const cases: [() => Response, string][] = [
    [() => new Response('no', { status: 401 }), 'HTTP 401'],
    [() => Response.json({ errors: [{ message: 'expired' }] }), 'unexpected body'],
    [() => Response.json({ data: { user_books: [{ book: null }] } }), 'unexpected body'],
    [() => new Response('{'), 'SyntaxError'],
    [() => new Response(`"${'x'.repeat(70_000)}"`), 'RangeError'],
    [
      () => {
        throw new TypeError(`network down, ${token}`);
      },
      'TypeError',
    ],
  ];
  for (const [answer, reason] of cases) {
    hardcoverAnswers(answer);
    assert.equal(await load(token), null);
    assert.equal(warnings.at(-1), `reading: no value from Hardcover (${reason})`);
  }
  assert.doesNotMatch(warnings.join('\n'), new RegExp(token));
});
