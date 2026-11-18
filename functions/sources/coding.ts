import {
  authorization,
  type Coding,
  currentUser,
  lastMonth,
  lastWeek,
  toCoding,
} from '../../src/data/coding';
import site from '../../src/data/site.json';
import { read } from '../answer';

// The newest day of the last seven with a minute of coding, its top language, the last heartbeat
// and the 30-day mix from WakaTime, or the reason there is none, safe to log; it never logs.
// `key` is WAKATIME_API_KEY, which holds an OAuth access token; keep the deployed secret name.
// One `ms` budget covers all three requests and their bodies; src/data/wakatime.ts allows 5 s.
export async function fetchCoding(key: string | undefined, ms: number): Promise<Coding | string> {
  if (!key) {
    return 'no WAKATIME_API_KEY';
  }
  try {
    const init = { headers: authorization(key), signal: AbortSignal.timeout(ms) };
    const [week, user, stats] = await Promise.all([
      fetch(lastWeek(site.timeZone), init),
      fetch(currentUser, init),
      fetch(lastMonth, init),
    ]);
    const failed = [week, user, stats].find((response) => response.status !== 200);
    if (failed) {
      return `HTTP ${failed.status}`;
    }
    return (
      toCoding(
        JSON.parse(await read(week, 1_048_576)),
        JSON.parse(await read(user, 1_048_576)),
        JSON.parse(await read(stats, 1_048_576)),
      ) ?? 'unexpected body'
    );
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the key.
    return error instanceof Error ? error.name : 'unknown error';
  }
}

// /api/activity's coding, or null when WakaTime gives none, within 2.5 s, under the hub's 5 s.
export async function load(key: string | undefined): Promise<Coding | null> {
  const value = await fetchCoding(key, 2_500);
  if (typeof value !== 'string') {
    return value;
  }
  console.warn(`coding: no value from WakaTime (${value})`);
  return null;
}
