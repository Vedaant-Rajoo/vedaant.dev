import { CONTRIBUTIONS_TOKEN } from 'astro:env/server';
import {
  type Contributions,
  contributionsRequest,
  graphql,
  graphqlError,
  toContributions,
} from './contributions';
import snapshot from './snapshots/contributions.json';

// The committed value, used when the token is unset or GitHub fails, so the build needs no
// network. contributions.test.ts checks its window.
const fallback: Contributions = snapshot;

async function load(): Promise<Contributions> {
  let reason = 'no CONTRIBUTIONS_TOKEN';
  try {
    if (CONTRIBUTIONS_TOKEN) {
      const now = Date.now();
      // One 5 s budget for the request and its body.
      const signal = AbortSignal.timeout(5_000);
      const response = await fetch(graphql, contributionsRequest(CONTRIBUTIONS_TOKEN, now, signal));
      const body = response.ok ? await response.json() : null;
      const value = toContributions(body, now);
      if (value) {
        return value;
      }
      reason = response.ok ? (graphqlError(body) ?? 'unexpected body') : `HTTP ${response.status}`;
    }
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the token.
    reason = error instanceof Error ? error.name : 'unknown error';
  }
  console.warn(`contributions: no value from GitHub (${reason}); using the committed snapshot`);
  return fallback;
}

// The contribution calendar when the site is built, for frontmatter; /api/activity serves the live
// one. A module's top level runs once per build, so every page that imports this shares one request.
export const contributions = await load();
