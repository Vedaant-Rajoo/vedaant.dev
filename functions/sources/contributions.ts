import {
  type Contributions,
  contributionsRequest,
  graphql,
  graphqlError,
  toContributions,
} from '../../src/data/contributions';
import { read } from '../answer';

// The public profile's GitHub contribution count for each UTC day of the window ending today, or
// the reason there is none, safe to log; it never logs. `token` is CONTRIBUTIONS_TOKEN, a
// fine-grained personal access token that reads public data only. One `ms` budget covers the
// request and its body; src/data/github.ts allows 5 s.
export async function fetchContributions(
  token: string | undefined,
  ms: number,
): Promise<Contributions | string> {
  if (!token) {
    return 'no CONTRIBUTIONS_TOKEN';
  }
  try {
    const now = Date.now();
    const response = await fetch(
      graphql,
      contributionsRequest(token, now, AbortSignal.timeout(ms)),
    );
    if (!response.ok) {
      return `HTTP ${response.status}`;
    }
    const body = JSON.parse(await read(response, 65_536));
    return toContributions(body, now) ?? graphqlError(body) ?? 'unexpected body';
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the token.
    return error instanceof Error ? error.name : 'unknown error';
  }
}

// /api/activity's contributions, or null when GitHub gives none, within 3 s, under the hub's 5 s.
export async function load(token: string | undefined): Promise<Contributions | null> {
  const value = await fetchContributions(token, 3_000);
  if (typeof value !== 'string') {
    return value;
  }
  console.warn(`contributions: no value from GitHub (${value})`);
  return null;
}
