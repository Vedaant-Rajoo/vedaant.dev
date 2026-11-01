import { z } from 'astro/zod';
import data from './shelf.json';
import { https } from './site';

// /shelf: three curated lists, and above them the reading, last-watched and on-repeat rows' build
// values, which the hub then keeps current. List rows keep their file order; an empty list is left
// out.
const text = z.string().trim().min(1);
const year = z.int().min(1000).max(9999);
const day = z.iso.date();
// Out of 5, in half stars.
const rating = z.number().min(0.5).max(5).multipleOf(0.5);
const item = { title: text, creator: text, year, sentence: text, link: https.optional() };
// The three live rows, exported so shelf-live.test.ts can check the Functions' rows against them.
export const reading = z.strictObject({
  title: text,
  creator: text,
  started: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  page: z.int().min(1).optional(),
});
export const lastWatched = z.strictObject({
  title: text,
  year,
  rating: rating.optional(),
  date: day,
});
// The on-repeat row's fallback; on-repeat.ts asks Last.fm for the week's top album at build.
export const listening = z.strictObject({ title: text, creator: text, plays: z.int().min(1) });

const result = z
  .strictObject({
    updated: day,
    summary: text,
    reading: reading.optional(),
    lastWatched: lastWatched.optional(),
    listening: listening.optional(),
    albums: z.array(z.strictObject(item)),
    films: z.array(z.strictObject({ ...item, rating: rating.optional() })),
    books: z.array(z.strictObject(item)),
  })
  .safeParse(data);
if (!result.success) {
  throw new Error(`src/data/shelf.json is invalid:\n${z.prettifyError(result.error)}`);
}

export const shelf = result.data;
