import type { CollectionEntry } from 'astro:content';

type Project = CollectionEntry<'projects'>;

// The /projects intro, as the owner's design writes it.
export const intro =
  'Things I built, newest first. Rows with a case study open it; the rest go straight to the repo. Work done for an employer is described at the level I am allowed to.';

// A body of at least this many words is a case study; a draft's counts only in `astro dev`.
const CASE_STUDY_WORDS = 500;
export const hasCaseStudy = ({ body = '', data }: Project) =>
  (import.meta.env.DEV || !data.draft) &&
  body.split(/\s+/).filter(Boolean).length >= CASE_STUDY_WORDS;

// Where a row links: its case study, else its repo unless the work is confidential, else
// nowhere.
export const rowHref = (project: Project) =>
  (hasCaseStudy(project) && `/projects/${project.id}`) ||
  (!project.data.confidential && project.data.repo) ||
  undefined;

// Newest first, then by file name.
export const newestFirst = (a: Project, b: Project) =>
  b.data.year - a.data.year || a.id.localeCompare(b.id);
