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
  schema: z.strictObject({
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
  }),
});

export const collections = { work, projects };
