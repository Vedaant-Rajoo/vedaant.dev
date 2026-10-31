import { WAKATIME_API_KEY } from 'astro:env/server';
import { authorization, type Coding, currentUser, lastMonth, statusBar, toCoding } from './coding';
import snapshot from './snapshots/wakatime.json';

// The committed value, used when the key is unset or WakaTime fails, so the build needs no
// network. coding.test.ts proves the hub accepts it.
const fallback = snapshot as Coding;

async function load(): Promise<Coding> {
  let reason = 'no WAKATIME_API_KEY';
  try {
    if (WAKATIME_API_KEY) {
      // One 5 s budget for all three requests and their bodies.
      const signal = AbortSignal.timeout(5_000);
      const init = { headers: authorization(WAKATIME_API_KEY), signal };
      const [bar, user, stats] = await Promise.all([
        fetch(statusBar, init),
        fetch(currentUser, init),
        fetch(lastMonth, init),
      ]);
      const failed = [bar, user, stats].find((response) => response.status !== 200);
      const value = failed
        ? null
        : toCoding(await bar.json(), await user.json(), await stats.json());
      if (value) {
        return value;
      }
      reason = failed ? `HTTP ${failed.status}` : 'unexpected body';
    }
  } catch (error) {
    // The name only: an error's message can quote a body.
    reason = error instanceof Error ? error.name : 'unknown error';
  }
  console.warn(`wakatime: no value from WakaTime (${reason}); using the committed snapshot`);
  return fallback;
}

// Today's coding when the site is built, for the /now cell's frontmatter; the hub reads
// /api/coding. A module's top level runs once per build, so every page that imports this shares
// one set of requests.
export const coding = await load();
