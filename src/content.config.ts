import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
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
      // https only: z.url() alone also accepts javascript: and mailto: URLs.
      url: z.url({ protocol: /^https$/ }).optional(),
      collapse: z.boolean().optional(),
    })
    .refine(({ start, end }) => end === null || end >= start, {
      path: ['end'],
      message: 'must not be before start',
      when: ({ issues }) => issues.length === 0,
    }),
});

export const collections = { work };
