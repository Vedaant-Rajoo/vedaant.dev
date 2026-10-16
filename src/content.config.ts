import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// https:// only. z.url() alone also accepts javascript: and mailto: URLs, and https:host, which a
// browser resolves against this site.
const https = z.url({ protocol: /^https$/ }).startsWith('https://');
const fromFile = file('src/data/work.json');

const work = defineCollection({
  // file() only logs a missing or unparsable file, and the build then keeps the previous build's
  // entries from node_modules/.astro. Clearing first and requiring an entry makes it fail instead.
  loader: {
    name: 'work',
    load: async (context) => {
      context.store.clear();
      await fromFile.load(context);
      if (context.store.keys().length === 0) {
        throw new Error('src/data/work.json has no entries');
      }
    },
  },
  schema: z
    .strictObject({
      employer: z.string().min(1),
      role: z.string().min(1),
      start: month,
      end: month.nullable(),
      summary: z.string().min(1).max(140),
      url: https.optional(),
      collapse: z.boolean().optional(),
    })
    .refine(({ start, end }) => end === null || end >= start, {
      path: ['end'],
      message: 'must not be before start',
      when: ({ issues }) => issues.length === 0,
    }),
});

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/content/projects' }),
  schema: z
    .strictObject({
      title: z.string().min(1),
      summary: z.string().min(1).max(90),
      year: z.int().min(1000).max(9999),
      // 24 characters fit the text column at 320px.
      stack: z.array(z.string().min(1).max(24)).max(4),
      status: z.enum(['active', 'done', 'archived']),
      featured: z.boolean(),
      draft: z.boolean().optional(),
      repo: https.optional(),
      // An npm package name, such as @scope/name.
      package: z.string().min(1).optional(),
      confidential: z.boolean().optional(),
      // An open-source contribution to someone else's repo: the link to my PRs there, which puts the
      // project in the open source group, and the month I began.
      prs: https.optional(),
      start: month.optional(),
      // A case study's dates (p13). Quote them: YAML reads an unquoted 2026-10-15 as a Date.
      published: z.iso.date().optional(),
      updated: z.iso.date().optional(),
    })
    .refine(
      ({ published, updated }) =>
        updated === undefined || (published !== undefined && updated > published),
      {
        path: ['updated'],
        message: 'must be after published',
        when: ({ issues }) => issues.length === 0,
      },
    ),
});

const writing = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/content/writing' }),
  schema: z
    .strictObject({
      title: z.string().min(1),
      summary: z.string().min(1),
      // A quoted day: YAML reads a bare 2025-02-30 as a Date, already moved to 2 March, so only a
      // string can be checked against the calendar.
      published: z.iso.date({
        error: "Invalid date: expected a real day in quotes, as '2025-03-14'",
      }),
      updated: z.iso
        .date({ error: "Invalid date: expected a real day in quotes, as '2025-03-14'" })
        .optional(),
      kind: z.enum(['post', 'note']),
      draft: z.boolean().default(false),
    })
    .refine(({ published, updated }) => updated === undefined || updated >= published, {
      path: ['updated'],
      message: 'must not be before published',
      when: ({ issues }) => issues.length === 0,
    }),
});

export const collections = { work, projects, writing };
