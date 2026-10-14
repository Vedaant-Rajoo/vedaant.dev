import type { CollectionEntry } from 'astro:content';

type Project = CollectionEntry<'projects'>;

// A body of at least this many words is a case study (FR-PR-4's 500); a draft's counts only in
// `astro dev` (p18).
const CASE_STUDY_WORDS = 500;
const hasCaseStudy = ({ body = '', data }: Project) =>
  (import.meta.env.DEV || !data.draft) &&
  body.split(/\s+/).filter(Boolean).length >= CASE_STUDY_WORDS;

// Where a row links: its case study, else its repo unless the work is confidential (FR-PR-6), else
// nowhere.
export const rowHref = (project: Project) =>
  (hasCaseStudy(project) && `/projects/${project.id}`) ||
  (!project.data.confidential && project.data.repo) ||
  undefined;

// The tile: the initials of the title's first two words, or the first two letters of one word.
export const tile = (title: string) => {
  const [first = title, second] = title.split(/[\s-]+/).filter(Boolean);
  return (second ? first[0] + second[0] : first.slice(0, 2)).toLowerCase();
};

// Newest first, then by file name (FR-PR-1).
export const newestFirst = (a: Project, b: Project) =>
  b.data.year - a.data.year || a.id.localeCompare(b.id);

// npm's rules for a new name, by character, case and length, so the link stays under /package/:
// lower-case letters, digits, ".", "_" and "-", with an optional @scope/; the name after a scope
// does not start with ".", and a name without one starts with a letter or a digit.
const npmName = /^(?:@[a-z0-9._-]+\/(?!\.)|(?=[a-z0-9]))[a-z0-9._-]+$/;

export const npmUrl = ({ data, filePath }: Project) => {
  const name = data.package;
  if (name !== undefined && (name.length > 214 || !npmName.test(name))) {
    throw new Error(`${filePath}: package "${name}" is not an npm package name`);
  }
  return name && `https://www.npmjs.com/package/${name}`;
};
