import { z } from 'astro/zod';
import data from './site.json';

// Parsed at build: a bad field fails `astro build` with a message that names site.json.
const result = z.object({ name: z.string().min(1) }).safeParse(data);
if (!result.success) {
  throw new Error(`src/data/site.json is invalid:\n${z.prettifyError(result.error)}`);
}
export const site = result.data;
