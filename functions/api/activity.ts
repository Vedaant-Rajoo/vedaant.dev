import { answer, type Context } from '../answer';
import { load as coding } from '../sources/coding';
import { load as lastWatched } from '../sources/last-watched';
import { load as onRepeat } from '../sources/on-repeat';
import { load as reading } from '../sources/reading';

// Workers add `default` to the global CacheStorage.
declare const caches: CacheStorage & { default: Cache };

// Each set, encrypted, in both Pages environments; `wrangler pages dev` reads a gitignored .env.
// The Letterboxd diary needs no key.
interface Env {
  WAKATIME_API_KEY?: string;
  HARDCOVER_TOKEN?: string;
  LASTFM_API_KEY?: string;
}

// Seconds an answer is kept: a day with every source, 10 minutes, the hub's longest wait after a
// failure, when one is missing, so a source that failed is asked again soon.
const day = 86_400;
const partial = 600;

export const onRequestGet = (context: Context<Env>) => handle(context, caches.default);

// GET /api/activity: the /now coding cell's value and /shelf's three live rows in one answer,
// `{ coding, reading, lastWatched, listening }`, each in the shape its source module gives: coding
// as the build-time snapshot, and each row in shelf.json's shape, or null when nothing is current.
// A source that fails is left out, so its widget keeps its text while the others update; with every
// source failing the answer is null. The six upstream requests run at once, within their sources'
// 2.5 and 3 s. Only the request's origin is read, so nothing of the visitor reaches a source.
export const handle = (context: Context<Env>, cache: Cache) =>
  answer(
    context,
    cache,
    '/api/activity',
    (body) => (Object.keys(body).length === 4 ? day : partial),
    async () => {
      const { env } = context;
      const [code, ...rows] = await Promise.all([
        coding(env.WAKATIME_API_KEY),
        reading(env.HARDCOVER_TOKEN),
        lastWatched(),
        onRepeat(env.LASTFM_API_KEY),
      ]);
      const body = Object.assign(code ? { coding: code } : {}, ...rows);
      return Object.keys(body).length > 0 ? body : null;
    },
  );
