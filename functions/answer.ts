// What every /api/* Function shares: its own headers, since _headers never reaches a Function's
// response; a Cache API entry per data centre; and 200 null with no-store on any failure, never a
// 5xx. This module exports no onRequest handler, so it is no route.

export interface Context<Env> {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
};

// Answers from this data centre's cache, keyed by the origin and the endpoint's path alone, so no
// query string, trailing slash or visitor header matters; or makes a body and keeps a non-null one
// for `seconds`. Browsers ask again each poll (max-age=0). A failing Cache API, as it may be behind
// Access on previews, counts as a miss: the answer never depends on the cache.
export async function answer<Env>(
  context: Context<Env>,
  cache: Cache,
  path: string,
  seconds: number,
  make: (origin: string) => Promise<unknown>,
): Promise<Response> {
  const { origin } = new URL(context.request.url);
  const key = `${origin}${path}`;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('X-Cache', 'hit');
    return response;
  }
  const body = (await make(origin)) ?? null;
  const response = Response.json(body, {
    headers: {
      ...headers,
      'Cache-Control': body ? `public, max-age=0, s-maxage=${seconds}` : 'no-store',
      'X-Cache': 'miss',
    },
  });
  if (body) {
    // A failed put only means the next request is a miss.
    context.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  }
  return response;
}
