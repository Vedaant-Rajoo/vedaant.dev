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

// https only: z.url() alone also accepts javascript: and mailto: URLs.
const https = z.url({ protocol: /^https$/ });

// One sentence, as Unicode splits them (UAX #29). An abbreviation before a capital ("U.S. Army")
// also ends one, so such a line counts high and fails rather than passes.
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const sentence = z
  .string()
  .trim()
  .min(1)
  .refine((text) => [...sentences.segment(text)].length <= 1, 'Too many sentences: expected 1');

// Parsed at build: a bad field fails `astro build` with a message that names site.json.
const result = z
  .object({
    name: z.string().min(1),
    hero: z
      .object({
        name: z.string().min(1),
        role: sentence,
        // FR-HE-3: at most one word in the serif.
        accent: z.string().regex(/^\S+$/, 'Invalid string: expected one word').optional(),
        mark: z.string().trim().min(1),
        today: sentence,
        previously: sentence,
      })
      .refine(({ role, accent }) => accent === undefined || role.includes(accent), {
        path: ['accent'],
        message: 'Invalid input: expected a word of hero.role',
        when: ({ issues }) => issues.length === 0,
      })
      .refine(({ role, mark }) => role.includes(mark), {
        path: ['mark'],
        message: 'Invalid input: expected a phrase of hero.role',
        when: ({ issues }) => issues.length === 0,
      }),
    timeZone,
    resume: z.object({ updated: z.iso.date() }),
    email: z.email(),
    socials: z.object({ github: https, linkedin: https }),
    source: https,
    // /now's "history ↗" (FR-NW-2): now.md's commit log on the repo host.
    history: https,
  })
  // GitHub's log of one file is <repo>/commits/<branch>/<path>; href has any ../ resolved.
  .refine(
    ({ source, history }) => {
      const { href } = new URL(history);
      return href.startsWith(`${source}/commits/`) && href.endsWith('/src/content/now/now.md');
    },
    {
      path: ['history'],
      message: 'Invalid input: expected the commit log of src/content/now/now.md in source',
      when: ({ issues }) => issues.length === 0,
    },
  )
  .safeParse(data);
if (!result.success) {
  throw new Error(`src/data/site.json is invalid:\n${z.prettifyError(result.error)}`);
}
export const site = result.data;

// The résumé links' "Mon YY" (FR-HE-4, D46). An ISO date is midnight UTC, so read it in UTC; 'en',
// because Node's en-GB writes "Sept".
export const resumeMonth = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
}).format(new Date(site.resume.updated));
