import { z } from 'astro/zod';
import data from './site.json';

// The clock's zone: Intl throws RangeError on a name it does not know.
const timeZone = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    return false;
  }
  // Intl also accepts an offset such as +05:30, which is not an IANA name.
  return !/^[+-]/.test(zone);
}, 'Invalid input: expected an IANA time zone');

// Parsed at build: a bad field fails `astro build` with a message that names site.json.
const result = z.object({ name: z.string().min(1), timeZone }).safeParse(data);
if (!result.success) {
  throw new Error(`src/data/site.json is invalid:\n${z.prettifyError(result.error)}`);
}
export const site = result.data;
