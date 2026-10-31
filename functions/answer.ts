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
// for `seconds`, or the seconds `seconds(body)` gives. Browsers keep it as long (max-age), so a
// poll or a page within that time reaches no Function. The Date a body was made with, and the
// Expires it goes stale at, which the hub polls by, stay on its entry, and a hit carries its Age,
// so a browser keeps a near-expiry hit only for what is left of it; an entry with no Date or past
// its lifetime, should a cache still hold one, is a miss. A
// failing Cache API, as it may be behind Access on previews, or one slower than 0.5 s, counts as a
// miss too: the answer never depends on the cache, and a slow read leaves `make` its upstream
// budget within the hub's 5 s.
export async function answer<Env>(
  context: Context<Env>,
  cache: Cache,
  path: string,
  seconds: number | ((body: object) => number),
  make: (origin: string) => Promise<unknown>,
): Promise<Response> {
  const { origin } = new URL(context.request.url);
  const key = `${origin}${path}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, 500, undefined);
  });
  const hit = await Promise.race([cache.match(key).catch(() => undefined), late]);
  clearTimeout(timer);
  const age = Math.floor((Date.now() - Date.parse(hit?.headers.get('date') ?? '')) / 1000);
  const lifetime = Number(/max-age=(\d+)/.exec(hit?.headers.get('cache-control') ?? '')?.[1]);
  if (hit && age < lifetime) {
    const response = new Response(hit.body, hit);
    // A clock that moved back gives no negative age.
    response.headers.set('Age', String(Math.max(age, 0)));
    response.headers.set('X-Cache', 'hit');
    return response;
  }
  const body = (await make(origin)) ?? null;
  const now = Date.now();
  const response = Response.json(body, {
    headers: { ...headers, Date: new Date(now).toUTCString(), 'X-Cache': 'miss' },
  });
  if (!body) {
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const kept = typeof seconds === 'number' ? seconds : seconds(body);
  response.headers.set('Cache-Control', `public, max-age=${kept}, s-maxage=${kept}`);
  response.headers.set('Expires', new Date(now + kept * 1000).toUTCString());
  // A failed put only means the next request is a miss.
  context.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return response;
}

// A response's body as text, read as it arrives and abandoned past `limit` bytes, whether or not
// it declares a Content-Length, so an upstream cannot make a Function hold an unlimited body. The
// caller's fetch signal still bounds the time. Throws a RangeError past the limit.
export async function read(response: Response, limit: number): Promise<string> {
  const tooLarge = () => new RangeError(`body over ${limit} bytes`);
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > limit) {
      throw tooLarge();
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
