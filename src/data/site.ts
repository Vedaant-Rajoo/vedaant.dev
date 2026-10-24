import { z } from 'astro/zod';
import { monthYear } from './format';
import data from './site.json';

// z.url() alone also accepts javascript: and mailto: URLs, and https:host, which a browser
// resolves against this site.
export const https = z.url({ protocol: /^https$/ }).startsWith('https://');

// Parsed at build: a bad field fails `astro build` with a message that names site.json.
const result = z
  .object({
    name: z.string().min(1),
    // The full name, for <title>, JSON-LD and the OG image; name stays the nav wordmark.
    fullName: z.string().trim().min(1),
    hero: z
      .object({
        name: z.string().min(1),
        role: z.string().trim().min(1),
        // At most one word in the serif.
        accent: z.string().regex(/^\S+$/, 'Invalid string: expected one word').optional(),
        mark: z.string().trim().min(1),
        today: z.string().trim().min(1),
      })
      // Hero.astro splits role around mark.
      .refine(({ role, mark }) => role.includes(mark), {
        path: ['mark'],
        message: 'Invalid input: expected a phrase of hero.role',
        when: ({ issues }) => issues.length === 0,
      }),
    timeZone: z.string().min(1),
    resume: z.object({ updated: z.iso.date() }),
    email: z.email(),
    socials: z.object({ github: https, linkedin: https }),
    source: https,
    // /now's "history ↗": now.md's commit log.
    history: https,
  })
  .safeParse(data);
if (!result.success) {
  throw new Error(`src/data/site.json is invalid:\n${z.prettifyError(result.error)}`);
}
export const site = result.data;

// The résumé links' "Mon ’YY".
export const resumeMonth = monthYear(site.resume.updated);

// The build's date and time in the owner's zone, read once so every page of a build agrees. An
// unknown zone throws here, failing the build.
export const built = Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', {
    timeZone: site.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
    .formatToParts()
    .map(({ type, value }) => [type, value]),
);
