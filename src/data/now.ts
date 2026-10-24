import { getEntry } from 'astro:content';

// The one now.md, for the home rows and /now. glob() only warns when the file is gone, so this
// fails the build instead, naming the file.
export const nowEntry = async () => {
  const now = await getEntry('now', 'now');
  if (now === undefined) {
    throw new Error('src/content/now/now.md is missing');
  }
  return now;
};
