import { z } from 'astro/zod';
import data from './shelf.json';
import { https } from './site';

// /shelf: three curated lists, each row with its one sentence, and the reading and last-watched
// rows above them. Rows keep their file order; an empty list is left out.
const text = z.string().trim().min(1);
const year = z.int().min(1000).max(9999);
const day = z.iso.date();
// Out of 5, in half stars.
const rating = z.number().min(0.5).max(5).multipleOf(0.5);
const item = { title: text, creator: text, year, sentence: text, link: https.optional() };

const result = z
  .strictObject({
    updated: day,
    summary: text,
    reading: z
      .strictObject({
        title: text,
        creator: text,
        started: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        page: z.int().min(1).optional(),
      })
      .optional(),
    // Was now.md's watched (D11), with the same fields.
    lastWatched: z
      .strictObject({
        title: text,
        year,
        rating: rating.optional(),
        date: day,
      })
      .optional(),
    albums: z.array(z.strictObject(item)),
    films: z.array(z.strictObject({ ...item, rating: rating.optional() })),
    books: z.array(z.strictObject(item)),
  })
  .safeParse(data);
if (!result.success) {
  throw new Error(`src/data/shelf.json is invalid:\n${z.prettifyError(result.error)}`);
}

export const shelf = result.data;
