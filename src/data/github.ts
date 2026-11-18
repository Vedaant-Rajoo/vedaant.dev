import { CONTRIBUTIONS_TOKEN } from 'astro:env/server';
import { fetchContributions } from '../../functions/sources/contributions';
import type { Contributions } from './contributions';
import snapshot from './snapshots/contributions.json';

async function load(): Promise<Contributions> {
  const value = await fetchContributions(CONTRIBUTIONS_TOKEN, 5_000);
  if (typeof value !== 'string') {
    return value;
  }
  console.warn(`contributions: no value from GitHub (${value}); using the committed snapshot`);
  // The committed value, used when the token is unset or GitHub fails, so the build needs no
  // network. contributions.test.ts checks its window.
  return snapshot;
}

// The contribution calendar when the site is built, for frontmatter; /api/activity serves the live
// one. A module's top level runs once per build, so every page that imports this shares one request.
export const contributions = await load();
