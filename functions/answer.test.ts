import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answer, read } from './answer';

const context = {
  env: {},
  request: new Request('https://vedaantrajoo.com/api/x?y=z'),
  waitUntil: () => {},
};

test('a cache read that never settles counts as a miss after 0.5 s', async () => {
  const cache = { match: () => new Promise(() => {}), put: async () => {} } as unknown as Cache;
  const started = performance.now();
  const response = await answer(context, cache, '/api/x', 60, async () => ({ value: 1 }));
  const waited = performance.now() - started;
  assert.equal(response.headers.get('x-cache'), 'miss');
  assert.deepEqual(await response.json(), { value: 1 });
  assert.ok(waited >= 450 && waited < 1_500, `waited ${waited} ms`);
});

test('a failing cache read is a miss too', async () => {
  const cache = {
    match: async () => {
      throw new Error('no cache behind Access');
    },
    put: async () => {},
  } as unknown as Cache;
  const response = await answer(context, cache, '/api/x', 60, async () => null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.json(), null);
});

// One cache entry, as a Map of one URL.
function oneEntry() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, response: Response) => {
      store.set(url, response);
    },
  } as unknown as Cache;
  const waits: Promise<unknown>[] = [];
  return {
    store,
    cache,
    context: { ...context, waitUntil: (p: Promise<unknown>) => waits.push(p) },
    waits,
  };
}

test('a body is kept by the edge and the browser alike, for the seconds its maker gives', async () => {
  const { store, cache, context: ctx, waits } = oneEntry();
  const response = await answer(
    ctx,
    cache,
    '/api/x',
    (body) => Object.keys(body).length * 100,
    async () => ({ a: 1, b: 2 }),
  );
  assert.equal(response.headers.get('cache-control'), 'public, max-age=200, s-maxage=200');
  const made = Date.parse(response.headers.get('date') ?? '');
  assert.ok(made > 0);
  assert.equal(response.headers.get('expires'), new Date(made + 200_000).toUTCString());
  assert.equal(response.headers.get('age'), null);
  await Promise.all(waits);
  assert.equal(
    store.get('https://vedaantrajoo.com/api/x')?.headers.get('cache-control'),
    'public, max-age=200, s-maxage=200',
  );
});

test('an entry with no Expires, or made ahead of the clock, still answers truthfully', async () => {
  const { store, cache, context: ctx } = oneEntry();
  const key = 'https://vedaantrajoo.com/api/x';
  // Without Expires its age is unknown, so it is a miss.
  store.set(
    key,
    Response.json(
      { old: 1 },
      {
        headers: {
          'cache-control': 'public, max-age=60, s-maxage=60',
          date: new Date().toUTCString(),
        },
      },
    ),
  );
  const miss = await answer(ctx, cache, '/api/x', 60, async () => ({ value: 1 }));
  assert.equal(miss.headers.get('x-cache'), 'miss');
  assert.deepEqual(await miss.json(), { value: 1 });
  // A clock that moved back gives Age 0, never a negative one.
  const ahead = Date.now() + 120_000;
  store.set(
    key,
    Response.json(
      { value: 2 },
      {
        headers: {
          'cache-control': 'public, max-age=60, s-maxage=60',
          expires: new Date(ahead + 60_000).toUTCString(),
        },
      },
    ),
  );
  const hit = await answer(ctx, cache, '/api/x', 60, async () => ({ value: 3 }));
  assert.equal(hit.headers.get('x-cache'), 'hit');
  assert.equal(hit.headers.get('age'), '0');
  assert.equal(hit.headers.get('date'), new Date(ahead).toUTCString());
  assert.deepEqual(await hit.json(), { value: 2 });
});

test('a cached entry without a complete max-age is a miss', async () => {
  const { store, cache, context: ctx } = oneEntry();
  for (const value of [undefined, 'no-cache', 's-maxage=60', 'x-max-age=60', 'max-age=60junk']) {
    store.set(
      'https://vedaantrajoo.com/api/x',
      Response.json(
        { old: 1 },
        {
          headers: {
            expires: new Date(Date.now() + 60_000).toUTCString(),
            ...(value ? { 'cache-control': value } : {}),
          },
        },
      ),
    );
    const response = await answer(ctx, cache, '/api/x', 60, async () => ({ value: 1 }));
    assert.equal(response.headers.get('x-cache'), 'miss', value);
    assert.deepEqual(await response.json(), { value: 1 });
  }
});

// Production hits carried a retrieval-time Date and Last-Modified matching Expires minus max-age.
// The rewrite layer is unverified; this fixture reproduces the observed headers.
test('a hit the cache dates when read keeps its own Date and Age, and still expires', async () => {
  const { store, cache, context: ctx } = oneEntry();
  const clock = Date.now;
  const readAt = (at: string) => {
    Date.now = () => Date.parse(at);
    store.set(
      'https://vedaantrajoo.com/api/x',
      Response.json(
        { value: 1 },
        {
          headers: {
            'cache-control': 'public, max-age=60, s-maxage=60',
            date: new Date(Date.parse(at)).toUTCString(),
            expires: 'Thu, 19 Nov 2026 10:46:00 GMT',
            'last-modified': 'Thu, 19 Nov 2026 10:45:00 GMT',
          },
        },
      ),
    );
    return answer(ctx, cache, '/api/x', 60, async () => ({ value: 2 }));
  };
  try {
    const hit = await readAt('2026-11-19T10:45:15.400Z');
    assert.equal(hit.headers.get('x-cache'), 'hit');
    assert.equal(hit.headers.get('date'), 'Thu, 19 Nov 2026 10:45:00 GMT');
    assert.equal(hit.headers.get('age'), '15');
    assert.deepEqual(await hit.json(), { value: 1 });
    const late = await readAt('2026-11-19T10:46:02.000Z');
    assert.equal(late.headers.get('x-cache'), 'miss');
    assert.deepEqual(await late.json(), { value: 2 });
  } finally {
    Date.now = clock;
  }
});

// A body that arrives in chunks, with no Content-Length.
const chunked = (...chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
  );

test('read() returns a body within the limit, multibyte characters split across chunks included', async () => {
  const [a, b] = [
    new TextEncoder().encode('é').slice(0, 1),
    new TextEncoder().encode('é').slice(1),
  ];
  const split = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(a);
        controller.enqueue(b);
        controller.close();
      },
    }),
  );
  assert.equal(await read(split, 2), 'é');
  assert.equal(await read(chunked('ab', 'cd'), 4), 'abcd');
  assert.equal(await read(new Response(null), 4), '');
});

test('read() stops past the limit, declared or not, without reading the rest', async () => {
  await assert.rejects(read(new Response('abcde'), 4), RangeError);
  await assert.rejects(read(chunked('ab', 'cd', 'e'), 4), RangeError);
  let pulled = 0;
  const endless = new Response(
    new ReadableStream({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1_024));
      },
    }),
  );
  await assert.rejects(read(endless, 4_096), RangeError);
  assert.ok(pulled < 10, `pulled ${pulled} chunks`);
  const declared = new Response('ab', { headers: { 'content-length': '10' } });
  await assert.rejects(read(declared, 4), RangeError);
});
