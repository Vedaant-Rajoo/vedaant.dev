import { z } from 'astro/zod';
import { https } from './site';
import data from './uses.json';

// /uses shows the groups in this order, each with its rows in file order. A retired row stays,
// struck through, with the year it was retired.
const names = ['hardware', 'editor and shell', 'desktop'] as const;

const result = z
  .array(
    z.strictObject({
      group: z.enum(names),
      name: z.string().trim().min(1),
      note: z.string().trim().min(1),
      url: https.optional(),
      retired: z.int().min(1000).max(9999).optional(),
    }),
  )
  .min(1)
  .safeParse(data);
if (!result.success) {
  throw new Error(`src/data/uses.json is invalid:\n${z.prettifyError(result.error)}`);
}

export const groups = names
  .map((group) => ({ group, rows: result.data.filter((row) => row.group === group) }))
  .filter(({ rows }) => rows.length > 0);
