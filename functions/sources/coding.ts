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

// /api/activity's coding: the newest day of the last seven with a minute of coding, its top
// language, the last heartbeat and the 30-day mix from WakaTime, or null when WakaTime gives none.
// `key` is WAKATIME_API_KEY, which holds an OAuth access token; keep the deployed secret name.
export async function load(key: string | undefined): Promise<Coding | null> {
  if (!key) {
    return fail('no WAKATIME_API_KEY');
  }
  try {
    // 2.5 s for all three requests and their bodies, under the hub's 5 s.
    const init = { headers: authorization(key), signal: AbortSignal.timeout(2_500) };
    const [week, user, stats] = await Promise.all([
      fetch(lastWeek(site.timeZone), init),
      fetch(currentUser, init),
      fetch(lastMonth, init),
    ]);
    const failed = [week, user, stats].find((response) => response.status !== 200);
    if (failed) {
      return fail(`HTTP ${failed.status}`);
    }
    return (
      toCoding(
        JSON.parse(await read(week, 1_048_576)),
        JSON.parse(await read(user, 1_048_576)),
        JSON.parse(await read(stats, 1_048_576)),
      ) ?? fail('unexpected body')
    );
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the key.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`coding: no value from WakaTime (${reason})`);
  return null;
}
