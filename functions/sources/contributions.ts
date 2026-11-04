import {
  type Contributions,
  contributionsRequest,
  graphql,
  graphqlError,
  toContributions,
} from '../../src/data/contributions';
import { read } from '../answer';

// /api/activity's contributions: the public profile's GitHub contribution count for each UTC day
// of the window ending today, or null when GitHub gives none. `token` is CONTRIBUTIONS_TOKEN, a
// fine-grained personal access token that reads public data only.
export async function load(token: string | undefined): Promise<Contributions | null> {
  if (!token) {
    return fail('no CONTRIBUTIONS_TOKEN');
  }
  try {
    const now = Date.now();
    // 3 s for the request and its body, under the hub's 5 s.
    const response = await fetch(
      graphql,
      contributionsRequest(token, now, AbortSignal.timeout(3_000)),
    );
    if (!response.ok) {
      return fail(`HTTP ${response.status}`);
    }
    const body = JSON.parse(await read(response, 65_536));
    return toContributions(body, now) ?? fail(graphqlError(body) ?? 'unexpected body');
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the token.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`contributions: no value from GitHub (${reason})`);
  return null;
}
