import { dayMonth, fullDay, initials, monthYear } from './format';
import type { OnRepeat } from './now-playing';

// /shelf's mappers, checks and text, in shelf.json's shapes, shared at build and in the browser.
// The page imports only checks and text, keeping mappers, hosts and queries out of client JS.
export interface Reading {
  title: string;
  creator: string;
  // YYYY-MM
  started?: string;
  page?: number;
}
export interface LastWatched {
  title: string;
  year: number;
  // Out of 5, in half stars.
  rating?: number;
  date: string;
}
// The rows /api/activity answers; a row left out is one whose source failed.
export interface Shelf {
  reading?: Reading | null;
  lastWatched?: LastWatched | null;
  listening?: OnRepeat | null;
}

// Mirrors shelf.ts without zod to keep client JS within budget: numeric year, rating, page and
// plays; strings for the rest. Years run from 1000 to 9999, ratings from 0.5 to 5 in half stars,
// and pages and plays from 1, short of 2^53.
const count = /^[1-9]\d{0,14}$/;
const patterns: Record<string, RegExp> = {
  title: /\S/,
  creator: /\S/,
  started: /^\d{4}-(0[1-9]|1[0-2])$/,
  date: /^\d{4}-\d\d-\d\d$/,
  year: /^[1-9]\d{3}$/,
  rating: /^(0\.5|[1-4](\.5)?|5)$/,
  page: count,
  plays: count,
};
// A date must also exist: 2026-02-30 is not one, whether Date rejects it or rolls it over.
const check = (name: string, value: unknown) =>
  typeof value === (/year|rating|page|plays/.test(name) ? 'number' : 'string') &&
  patterns[name].test(value as string) &&
  (name !== 'date' ||
    new Date(value as string).getUTCDate() === Number((value as string).slice(8)));
// Each row's field names, sorted, the optional ones in parentheses: left out when unknown, never
// null.
const rows = {
  reading: /^creator,(page,)?(started,)?title$/,
  lastWatched: /^date,(rating,)?title,year$/,
  listening: /^creator,plays,title$/,
};

function fits(value: unknown, names: RegExp) {
  const row = Object(value);
  const keys = Object.keys(row);
  return names.test(keys.sort().join()) && keys.every((name) => check(name, row[name]));
}

// Checks the three rows of a parsed /api/activity body: each null for nothing current, or a row in
// shelf.json's shape and nothing more. A row the body leaves out, or one that fails its check, is
// left out, so its widget keeps its text while the others update; null when no row is left, so the
// hub treats the answer as a failure.
export function shelfFromLive(body: unknown): Shelf | null {
  const value = Object(body);
  const kept = (Object.keys(rows) as (keyof typeof rows)[]).filter(
    (name) => value[name] !== undefined && (value[name] === null || fits(value[name], rows[name])),
  );
  return kept.length > 0 ? Object.fromEntries(kept.map((name) => [name, value[name]])) : null;
}

// "★★★★½"; repeat() drops the half.
export const stars = (value: number) => '★'.repeat(value) + (value % 1 ? '½' : '');
// "Title (2010)". The title sits between U+2068 and U+2069, as artists do in now-playing.ts, so a
// right-to-left title does not pull the year to its left.
export const withYear = (title: string, year: number) => `\u2068${title}\u2069 (${year})`;

// Each row's texts by their data-row hooks, and last watched's date for its <time>, with the whole
// day for its <abbr>, as a /writing row's date. Nothing current reads "—".
export const readingText = (row: Reading | null) => ({
  tile: row ? initials(row.title) : '',
  title: `reading · ${row?.title ?? '—'}`,
  sub: row ? row.creator + (row.started ? ` · started ${monthYear(row.started)}` : '') : '',
  meta: row?.page ? `p. ${row.page}` : '',
});
export const watchedText = (row: LastWatched | null) => ({
  tile: row ? initials(row.title) : '',
  title: `last watched · ${row ? withYear(row.title, row.year) : '—'}`,
  sub: '',
  stars: row?.rating ? stars(row.rating) : '',
  rated: row?.rating ? `rated ${row.rating} of 5` : '',
  meta: row ? dayMonth(row.date) : '',
  date: row?.date ?? null,
  full: row ? fullDay(row.date) : '',
});
export const listeningText = (row: OnRepeat | null) => ({
  tile: '♪',
  title: `on repeat · ${row?.title ?? '—'}`,
  sub: row ? `${row.creator} · last 7 days` : '',
  meta: row ? `${row.plays} ${row.plays === 1 ? 'play' : 'plays'}` : '',
});

// Each live row's source, by its data-widget, credited as /now's cells credit theirs.
export const credits = {
  reading: { label: 'via hardcover', href: 'https://hardcover.app/' },
  'last-watched': { label: 'via letterboxd', href: 'https://letterboxd.com/' },
  'on-repeat': { label: 'via last.fm', href: 'https://www.last.fm/' },
};

// The texts of the row a widget shows, by its data-widget; none when the answer leaves it out.
// Annotated, so the union keeps last watched's own fields.
export function shelfText(
  { reading, lastWatched, listening }: Shelf,
  { dataset: { widget: kind } }: { dataset: DOMStringMap },
):
  | ReturnType<typeof readingText>
  | ReturnType<typeof watchedText>
  | ReturnType<typeof listeningText>
  | undefined {
  if (kind === 'reading') {
    return reading === undefined ? undefined : readingText(reading);
  }
  if (kind === 'last-watched') {
    return lastWatched === undefined ? undefined : watchedText(lastWatched);
  }
  return listening === undefined ? undefined : listeningText(listening);
}

// A row a mapper built, if it fits its rules; null otherwise.
const checked = <T>(name: keyof typeof rows, row: T) => (fits(row, rows[name]) ? row : null);

// Hardcover's reading row: user 191390 is the owner's public id, so no `me` query is needed.
// The Function sends HARDCOVER_TOKEN. Status 2 is "currently reading". The latest updated
// book and its latest read win; the outer limit only trims the answer.
export const hardcover = 'https://api.hardcover.app/v1/graphql';
export const readingQuery = `{
  user_books(
    where: { user_id: { _eq: 191390 }, status_id: { _eq: 2 } }
    order_by: { updated_at: desc }
    limit: 1
  ) {
    updated_at
    book { title release_year contributions { contribution author { name } } }
    user_book_reads(order_by: { id: desc }, limit: 1) { started_at progress_pages }
  }
}`;

interface Contribution {
  contribution?: unknown;
  author?: { name?: unknown } | null;
}

// Maps a parsed Hardcover answer: the current book; undefined when none is current; null when the
// body is not one, has GraphQL errors, or its book has no title or credited name. The creator is
// the book's authors, a contribution without a role or "Author"; when it lists none of those,
// everyone credited, in Hardcover's order.
export function toReading(body: unknown): Reading | undefined | null {
  const { data, errors } = (body ?? {}) as { data?: { user_books?: unknown }; errors?: unknown };
  const books = data?.user_books;
  if (errors !== undefined || !Array.isArray(books)) {
    return null;
  }
  if (books.length === 0) {
    return undefined;
  }
  const { book, user_book_reads: reads } = (books[0] ?? {}) as {
    book?: { title?: unknown; contributions?: unknown } | null;
    user_book_reads?: unknown;
  };
  const credits = book?.contributions;
  if (!Array.isArray(credits) || !Array.isArray(reads)) {
    return null;
  }
  const authors = (credits as Contribution[]).filter(
    (credit) => credit?.contribution == null || credit.contribution === 'Author',
  );
  const creator = (authors.length > 0 ? authors : (credits as Contribution[]))
    .map((credit) => credit?.author?.name)
    .filter((name) => check('creator', name))
    .map((name) => (name as string).trim())
    .join(', ');
  const read = (reads[0] ?? {}) as { started_at?: unknown; progress_pages?: unknown };
  const started = typeof read.started_at === 'string' ? read.started_at.slice(0, 10) : '';
  const page = read.progress_pages;
  return checked('reading', {
    title: typeof book?.title === 'string' ? book.title.trim() : book?.title,
    creator,
    ...(check('date', started) && { started: started.slice(0, 7) }),
    ...(check('page', page) && { page }),
  } as Reading);
}

// The owner's Letterboxd diary, for /api/activity's lastWatched row: public, no key.
export const letterboxd = 'https://letterboxd.com/newedia/rss/';

const leaves = new Set([
  'letterboxd:filmTitle',
  'letterboxd:filmYear',
  'letterboxd:watchedDate',
  'letterboxd:memberRating',
]);
const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const open = /<([A-Za-z_][\w.:-]*)(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>/y;
const close = /<\/([A-Za-z_][\w.:-]*)\s*>/y;

// Ordinary XML text with its five entities and character references decoded, once; null when it has
// an entity XML does not define, or a bare &.
function decode(raw: string) {
  let bad = false;
  const decoded = raw.replace(/&([^;&]*);?/g, (match, name: string) => {
    const code = /^#(?:x([0-9a-f]+)|(\d+))$/i.exec(name);
    const point = code ? Number.parseInt(code[1] ?? code[2], code[1] ? 16 : 10) : Number.NaN;
    const ok =
      match.endsWith(';') && (Object.hasOwn(named, name) || (point > 0 && point <= 0x10ffff));
    bad ||= !ok || (point >= 0xd800 && point <= 0xdfff);
    return ok && !bad ? (named[name] ?? String.fromCodePoint(point)) : '';
  });
  return bad ? null : decoded;
}

// Where the scan is: the open elements, whether the root and a channel were seen, the item being
// read and the leaf in it, and the entry chosen so far.
interface Feed {
  path: string[];
  channel: boolean;
  ended: boolean;
  item?: Record<string, string>;
  leaf?: string;
  best?: Record<string, string>;
}
interface Token {
  end: number;
  name?: string;
  closing?: boolean;
  empty?: boolean;
  text?: string;
}
const sections = [
  ['<!--', '-->'],
  ['<?', '?>'],
  ['<![CDATA[', ']]>'],
];

// The markup at `at`, a "<": a tag, or a comment, processing instruction or CDATA section, which
// hold no elements; a CDATA section's text is literal. Null for anything else, such as a DOCTYPE,
// which could declare entities, or a section without its end.
function markup(xml: string, at: number): Token | null {
  for (const [start, stop] of sections) {
    if (xml.startsWith(start, at)) {
      const done = xml.indexOf(stop, at + start.length);
      const text = start === '<![CDATA[' ? xml.slice(at + start.length, done) : '';
      return done === -1 ? null : { end: done + stop.length, text };
    }
  }
  for (const [pattern, closing] of [
    [close, true],
    [open, false],
  ] as const) {
    pattern.lastIndex = at;
    const match = pattern.exec(xml);
    if (match) {
      return { end: pattern.lastIndex, name: match[1], closing, empty: match[2] === '/' };
    }
  }
  return null;
}

// Adds text to the leaf being read, if any; false for text XML does not allow.
function append(feed: Feed, text: string | null) {
  if (text === null || (feed.path.length === 0 && text.trim() !== '')) {
    return false;
  }
  if (feed.item && feed.leaf) {
    feed.item[feed.leaf] += text;
  }
  return true;
}

// Opens an element; false for a second root, a root that is not <rss>, or markup in a leaf.
function enter(feed: Feed, name: string) {
  // shortcut: at most 32 XML levels, raise if a real Letterboxd feed needs deeper markup
  if (
    feed.ended ||
    feed.leaf ||
    feed.path.length >= 32 ||
    (feed.path.length === 0 && name !== 'rss')
  ) {
    return false;
  }
  const depth = feed.path.push(name);
  feed.channel ||= depth === 2 && name === 'channel';
  if (depth === 3 && feed.path[1] === 'channel' && name === 'item') {
    feed.item = {};
  } else if (feed.item && depth === 4 && leaves.has(name)) {
    feed.leaf = name;
    feed.item[name] = '';
  }
  return true;
}

// Closes an element; false when it is not the one open. A closed item with a film title and a
// valid watched date becomes the choice when its date is later than the choice's.
function leave(feed: Feed, name: string) {
  if (feed.path.pop() !== name) {
    return false;
  }
  if (feed.leaf === name) {
    feed.leaf = undefined;
  }
  const item = feed.item;
  if (item && name === 'item' && feed.path.length === 2) {
    const watched = item['letterboxd:watchedDate']?.trim() ?? '';
    const best = feed.best?.['letterboxd:watchedDate'].trim() ?? '';
    if (item['letterboxd:filmTitle']?.trim() && check('date', watched) && watched > best) {
      item['letterboxd:watchedDate'] = watched;
      feed.best = item;
    }
    feed.item = undefined;
  }
  feed.ended = feed.path.length === 0;
  return true;
}

// Reads one token; false when it breaks the document.
function step(feed: Feed, { name, closing, empty, text = '' }: Token) {
  if (!append(feed, text)) {
    return false;
  }
  if (name === undefined) {
    return true;
  }
  return (closing || enter(feed, name)) && (!(closing || empty) || leave(feed, name));
}

// Maps the diary feed's text: the entry with the latest watched date, the earlier one in the feed
// on a tie, never the latest posted; undefined when the feed has no diary entry; null when the text
// is not a whole RSS document or the chosen entry has no usable title or year. Items without a film
// title or a watched date, as lists are, are skipped. A rating from 0.5 to 5 in half stars is kept;
// none, 0 or anything else leaves it out.
// shortcut: four letterboxd:* text leaves or one CDATA section, use an XML parser for nested markup
export function toLastWatched(xml: string): LastWatched | undefined | null {
  const feed: Feed = { path: [], channel: false, ended: false };
  // Each turn reads the text up to the next "<", then the markup there, so `at` always moves on.
  let at = 0;
  while (at < xml.length) {
    const next = xml.indexOf('<', at);
    const end = next === -1 ? xml.length : next;
    const token = next === -1 ? { end } : markup(xml, next);
    const raw = xml.slice(at, end);
    if (!append(feed, feed.leaf ? decode(raw) : raw) || !token || !step(feed, token)) {
      return null;
    }
    at = token.end;
  }
  return feed.ended && feed.channel ? chosen(feed.best) : null;
}

function chosen(best: Record<string, string> | undefined) {
  if (!best) {
    return undefined;
  }
  const year = best['letterboxd:filmYear']?.trim() ?? '';
  const value = Number(best['letterboxd:memberRating']?.trim() || Number.NaN);
  return checked('lastWatched', {
    title: best['letterboxd:filmTitle'].trim(),
    year: /^\d{4}$/.test(year) ? Number(year) : Number.NaN,
    ...(check('rating', value) && { rating: value }),
    date: best['letterboxd:watchedDate'].trim(),
  });
}
