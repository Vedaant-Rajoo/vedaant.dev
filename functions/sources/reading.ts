import { hardcover, type Reading, readingQuery, toReading } from '../../src/data/shelf-live';
import { read } from '../answer';

// /api/activity's reading row: the book the owner is reading on Hardcover, in shelf.json's
// `reading` shape, or null as the row when none is current; null for no answer.
// `token` is HARDCOVER_TOKEN, with read:me, read:library and read:catalog scopes.
export async function load(token: string | undefined): Promise<{ reading: Reading | null } | null> {
  if (!token) {
    return fail('no HARDCOVER_TOKEN');
  }
  try {
    // 3 s for the request and its body, under the hub's 5 s.
    const response = await fetch(hardcover, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: readingQuery }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return fail(`HTTP ${response.status}`);
    }
    const value = toReading(JSON.parse(await read(response, 65_536)));
    return value === null ? fail('unexpected body') : { reading: value ?? null };
  } catch (error) {
    // The name only: an error's message can quote a request, and with it the token.
    return fail(error instanceof Error ? error.name : 'unknown error');
  }
}

function fail(reason: string) {
  console.warn(`reading: no value from Hardcover (${reason})`);
  return null;
}
