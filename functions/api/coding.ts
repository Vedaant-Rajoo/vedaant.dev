import {
  authorization,
  type Coding,
  currentUser,
  statusBar,
  toCoding,
} from '../../src/data/coding';
import { answer, type Context } from '../answer';

// Workers add `default` to the global CacheStorage.
declare const caches: CacheStorage & { default: Cache };

// WAKATIME_API_KEY: set, encrypted, in both Pages environments; `wrangler pages dev` reads a
// gitignored .env. WakaTime asks never to use it on a public website: it stays in this Function.
interface Env {
  WAKATIME_API_KEY?: string;
}

export const onRequestGet = (context: Context<Env>) => handle(context, caches.default);

// GET /api/coding: today's coding time, top language and last heartbeat, kept 60 s per data
// centre (FR-CD-2). Only the request's origin is read, so nothing of the visitor reaches WakaTime.
export const handle = (context: Context<Env>, cache: Cache) =>
  answer(context, cache, '/api/coding', 60, () => load(context.env.WAKATIME_API_KEY));

async function load(key: string | undefined): Promise<Coding | null> {
  if (!key) {
    return fail('no WAKATIME_API_KEY');
  }
  try {
    // 2.5 s for both requests and their bodies, under the hub's 5 s.
    const init = { headers: authorization(key), signal: AbortSignal.timeout(2_500) };
    const [bar, user] = await Promise.all([fetch(statusBar, init), fetch(currentUser, init)]);
    if (!bar.ok || !user.ok) {
      return fail(`HTTP ${bar.ok ? user.status : bar.status}`);
    }
    return toCoding(await bar.json(), await user.json()) ?? fail('unexpected body');
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the key.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`coding: no value from WakaTime (${reason})`);
  return null;
}
