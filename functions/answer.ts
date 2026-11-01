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

// The cache key excludes query strings, trailing slashes and visitor headers.
// Hits retain Date and Expires; Age leaves browsers only the remaining lifetime.
// Missing Date or expired entries are misses, even if the cache still holds them.
// Access on previews can break cache reads; failed or >0.5 s reads miss to preserve the 5 s budget.
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
