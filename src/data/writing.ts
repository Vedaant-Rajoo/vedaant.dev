import { getCollection } from 'astro:content';

export const intro =
  'Posts are long and sourced; notes are short and sometimes wrong. Both are dated.';

// Every piece, newest first, then by file name; a draft only in `astro dev`. Every list
// of writing (home, /writing, the post pages, the feed, the sitemap) comes from here, so a draft
// cannot leak through one of them and not the others.
export const pieces = async () =>
  (await getCollection('writing', ({ data }) => import.meta.env.DEV || !data.draft)).sort(
    (a, b) => b.data.published.localeCompare(a.data.published) || a.id.localeCompare(b.id),
  );
