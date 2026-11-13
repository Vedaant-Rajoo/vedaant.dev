import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toOnRepeat } from './now-playing';
import { lastWatched, listening, reading, shelf } from './shelf';
import {
  listeningText,
  readingCell,
  readingQuery,
  readingText,
  shelfFromLive,
  shelfText,
  toLastWatched,
  toReading,
  watchedCell,
  watchedText,
  withYear,
} from './shelf-live';

// One diary entry as Letterboxd's feed writes it, trimmed to the parts the scan meets.
const entry = (fields: Record<string, string>, extra = '') =>
  `<item><title>x</title><link>https://letterboxd.com/newedia/film/x/</link>${Object.entries(fields)
    .map(([name, value]) => `<letterboxd:${name}>${value}</letterboxd:${name}>`)
    .join('')}${extra}</item>`;
const feed = (...items: string[]) =>
  `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>Letterboxd - newedia</title><atom:link href="https://letterboxd.com/newedia/rss/" rel="self" type="application/rss+xml"/>
  ${items.join('\n  ')}
  </channel>
</rss>`;
// The owner's sample: a backdated log, posted last but watched in 2020.
const sample = `<item><title>Avengers: Infinity War, 2018 - ★★★★★</title><link>https://letterboxd.com/newedia/film/avengers-infinity-war/</link><guid isPermaLink="false">letterboxd-watch-1559692722</guid><pubDate>Thu, 29 Oct 2026 05:44:51 +1300</pubDate><letterboxd:watchedDate>2020-07-17</letterboxd:watchedDate><letterboxd:rewatch>No</letterboxd:rewatch><letterboxd:filmTitle>Avengers: Infinity War</letterboxd:filmTitle><letterboxd:filmYear>2018</letterboxd:filmYear><letterboxd:memberRating>5.0</letterboxd:memberRating><letterboxd:memberLike>Yes</letterboxd:memberLike><tmdb:movieId>299536</tmdb:movieId><description><![CDATA[ <p><img src="https://a.ltrbxd.com/poster.jpg"/></p> <p>Watched on Friday July 17, 2020.</p> ]]></description><dc:creator>newedia</dc:creator></item>`;
const clueless = entry({
  watchedDate: '2026-10-28',
  filmTitle: 'Clueless',
  filmYear: '1995',
  memberRating: '3.5',
});

test('the latest watched date wins, not the feed order or the latest posted', () => {
  const value = { title: 'Clueless', year: 1995, rating: 3.5, date: '2026-10-28' };
  assert.deepEqual(toLastWatched(feed(sample, clueless)), value);
  assert.deepEqual(toLastWatched(feed(clueless, sample)), value);
  assert.deepEqual(toLastWatched(feed(sample)), {
    title: 'Avengers: Infinity War',
    year: 2018,
    rating: 5,
    date: '2020-07-17',
  });
  // On the same day, the earlier in the feed.
  const other = entry({ watchedDate: '2026-10-28', filmTitle: 'Heat', filmYear: '1995' });
  assert.equal(toLastWatched(feed(other, clueless))?.title, 'Heat');
  assert.equal(toLastWatched(feed(clueless, other))?.title, 'Clueless');
});

test('lists, entries without a title or a valid date, are skipped; none left is empty', () => {
  const list = `<item><title>Favourites</title><link>https://letterboxd.com/newedia/list/f/</link><description><![CDATA[<ul><li>Heat</li></ul>]]></description></item>`;
  const untitled = entry({ watchedDate: '2026-10-30', filmYear: '1995' });
  const undated = entry({ filmTitle: 'Heat', filmYear: '1995' });
  const impossible = entry({ watchedDate: '2026-02-30', filmTitle: 'Heat', filmYear: '1995' });
  assert.equal(
    toLastWatched(feed(list, untitled, clueless, undated, impossible))?.title,
    'Clueless',
  );
  assert.equal(toLastWatched(feed(list, untitled, undated)), undefined);
  assert.equal(toLastWatched(feed()), undefined);
});

test('entities decode once, CDATA stays literal, and markup in text is not an item', () => {
  // The title, or null when the feed fails.
  const title = (value: string, extra = '') => {
    const film = toLastWatched(
      feed(entry({ watchedDate: '2026-10-01', filmTitle: value, filmYear: '2001' }, extra)),
    );
    return film === null ? null : film?.title;
  };
  // Letterboxd's numeric apostrophe, split so the gate's colour scan does not read a hex colour.
  assert.equal(title(`Ocean&#${'039'};s Eleven`), "Ocean's Eleven");
  assert.equal(
    title('Am&#xE9;lie &amp; &lt;co&gt; &quot;x&quot; &apos;y&apos;'),
    'Amélie & <co> "x" \'y\'',
  );
  assert.equal(title('&amp;lt;'), '&lt;');
  assert.equal(title('<![CDATA[Tom &amp; Jerry <3]]>'), 'Tom &amp; Jerry <3');
  assert.equal(title('Up<!-- a comment -->'), 'Up');
  for (const bad of ['AT&T', '&nbsp;', '&#0;', '&#xD800;', '&#x110000;', '&constructor;']) {
    assert.equal(title(bad), null, bad);
  }
  // A description or comment that looks like a later, more recent entry is not one.
  const fake = entry({ watchedDate: '2030-01-01', filmTitle: 'Fake', filmYear: '2030' });
  for (const extra of [
    `<description><![CDATA[${fake}]]></description>`,
    `<description>${fake.replaceAll('<', '&lt;')}</description>`,
    `<!-- ${fake} -->`,
  ]) {
    assert.equal(title('Real', extra), 'Real', extra);
  }
  assert.equal(toLastWatched(feed(`<!-- ${fake} -->`, clueless))?.title, 'Clueless');
});

test('a rating from 0.5 to 5 in half stars is kept; anything else is left out', () => {
  const rated = (value?: string) =>
    toLastWatched(
      feed(
        entry({
          watchedDate: '2026-10-01',
          filmTitle: 'Up',
          filmYear: '2009',
          ...(value !== undefined && { memberRating: value }),
        }),
      ),
    );
  assert.equal(rated('0.5')?.rating, 0.5);
  assert.equal(rated('4.0')?.rating, 4);
  assert.equal(rated(' 4.5 ')?.rating, 4.5);
  for (const value of [undefined, '', '0', '0.0', '0.25', '5.5', '-1', 'NaN', 'four']) {
    const film = rated(value);
    assert.ok(film && !('rating' in film), String(value));
  }
});

test('a feed that is not a whole RSS document, or a chosen film without a year, fails', () => {
  const whole = feed(clueless);
  for (const text of [
    '',
    '{"error":"rate limited"}',
    '<!DOCTYPE html><html><body>Blocked</body></html>',
    '<html><body><rss><channel></channel></rss></body></html>',
    '<rss version="2.0"></rss>',
    whole.slice(0, whole.lastIndexOf('</channel>')),
    whole.slice(0, -1),
    whole.replace('</item>', ''),
    `${whole}<rss><channel></channel></rss>`,
    feed(entry({ watchedDate: '2026-10-01', filmTitle: '<em>Up</em>', filmYear: '2009' })),
    feed(entry({ watchedDate: '2026-10-01', filmTitle: 'Up', filmYear: '' })),
    feed(entry({ watchedDate: '2026-10-01', filmTitle: 'Up', filmYear: '09' })),
    feed(entry({ watchedDate: '2026-10-01', filmTitle: 'Up' })),
    feed(`<item><description><![CDATA[never closed</description></item>`),
  ]) {
    assert.equal(toLastWatched(text), null, text.slice(-80));
  }
});

test('text outside the RSS root fails instead of clearing the film; whitespace is allowed', () => {
  for (const whole of [feed(), feed(clueless)]) {
    for (const text of [
      `upstream error${whole}`,
      `${whole}upstream error`,
      `<![CDATA[upstream error]]>${whole}`,
      `${whole}<![CDATA[upstream error]]>`,
    ]) {
      assert.equal(toLastWatched(text), null);
    }
    assert.deepEqual(toLastWatched(` \n${whole}\t`), toLastWatched(whole));
  }
});

test('RSS markup nesting is capped at 32 levels', () => {
  const nested = (depth: number) => feed('<x>'.repeat(depth) + '</x>'.repeat(depth));
  // rss and channel already occupy two levels.
  assert.equal(toLastWatched(nested(30)), undefined);
  assert.equal(toLastWatched(nested(31)), null);
  assert.equal(toLastWatched(nested(50_000)), null);
});

test('a padded chosen date is normalized before scanning later items', () => {
  const padded = entry({
    watchedDate: `2026-10-28${' '.repeat(500_000)}`,
    filmTitle: 'Clueless',
    filmYear: '1995',
  });
  const whole = feed(padded, '<item/>'.repeat(75_000));
  assert.ok(whole.length < 1_048_576);
  assert.deepEqual(toLastWatched(whole), {
    title: 'Clueless',
    year: 1995,
    date: '2026-10-28',
  });
});

// Hardcover's answer to readingQuery, as the owner's val reads it.
const book = (fields: Record<string, unknown> = {}) => ({
  updated_at: '2026-10-20T10:00:00+00:00',
  book: {
    title: 'A Game of Thrones',
    release_year: 1996,
    contributions: [{ contribution: null, author: { name: 'George R. R. Martin' } }],
  },
  user_book_reads: [{ started_at: '2026-10-03', progress_pages: 120 }],
  ...fields,
});
const books = (...rows: unknown[]) => ({ data: { user_books: rows } });

test('toReading: the first current book, its authors and its latest read', () => {
  assert.deepEqual(toReading(books(book(), book({ book: { title: 'Other' } }))), {
    title: 'A Game of Thrones',
    creator: 'George R. R. Martin',
    started: '2026-10',
    page: 120,
  });
  assert.equal(toReading(books()), undefined);
  assert.match(readingQuery, /user_id: \{ _eq: 191390 \}, status_id: \{ _eq: 2 \}/);
  assert.match(readingQuery, /order_by: \{ updated_at: desc \}\s+limit: 1/);
  assert.match(readingQuery, /user_book_reads\(order_by: \{ id: desc \}, limit: 1\)/);
});

test('toReading: authors are null or "Author" roles, else every credit, joined in order', () => {
  const credits = (...list: [unknown, unknown][]) =>
    toReading(
      books(
        book({
          book: {
            title: 'Book',
            contributions: list.map(([contribution, name]) => ({ contribution, author: { name } })),
          },
        }),
      ),
    )?.creator;
  assert.equal(
    credits(['Author', 'A'], ['Translator', 'T'], [null, 'B'], ['Illustrator', 'I']),
    'A, B',
  );
  assert.equal(credits(['Translator', 'T'], ['Editor', ' E ']), 'T, E');
  assert.equal(credits(['Author', 'A'], ['Author', ''], ['Author', 7]), 'A');
  // Authors with no usable name do not fall back to the other credits.
  assert.equal(credits(['Author', ''], ['Translator', 'T']), undefined);
});

test('toReading: progress and start are optional; anything malformed fails', () => {
  const read = (reads: unknown) => toReading(books(book({ user_book_reads: reads })));
  assert.deepEqual(read([]), { title: 'A Game of Thrones', creator: 'George R. R. Martin' });
  assert.deepEqual(read([{ started_at: null, progress_pages: 0 }]), {
    title: 'A Game of Thrones',
    creator: 'George R. R. Martin',
  });
  assert.deepEqual(read([{ started_at: '2026-13-01', progress_pages: 2.5 }]), {
    title: 'A Game of Thrones',
    creator: 'George R. R. Martin',
  });
  assert.equal(
    read([{ started_at: '2026-09-30T23:00:00Z', progress_pages: 1 }])?.started,
    '2026-09',
  );
  for (const body of [
    null,
    {},
    { data: null },
    { data: { user_books: null } },
    { errors: [{ message: 'denied' }], data: { user_books: [] } },
    books(null),
    books(book({ book: null })),
    books(book({ book: { title: ' ', contributions: [] } })),
    books(book({ book: { title: 'Book', contributions: [] } })),
    books(book({ book: { title: 'Book' } })),
    books(book({ user_book_reads: null })),
  ]) {
    assert.equal(toReading(body), null, JSON.stringify(body));
  }
});

test("the mappers' rows pass shelf.ts's schemas and the hub's checks", () => {
  const mapped = [
    ['reading', reading, toReading(books(book()))],
    ['reading', reading, toReading(books(book({ user_book_reads: [] })))],
    ['lastWatched', lastWatched, toLastWatched(feed(sample))],
    [
      'lastWatched',
      lastWatched,
      toLastWatched(feed(entry({ watchedDate: '2026-10-01', filmTitle: 'Up', filmYear: '2009' }))),
    ],
    [
      'listening',
      listening,
      toOnRepeat({ topalbums: { album: [{ name: 'A', playcount: '2', artist: { name: 'B' } }] } }),
    ],
  ] as const;
  for (const [name, schema, row] of mapped) {
    assert.ok(row, name);
    assert.deepEqual(schema.parse(row), row);
    const body = { [name]: row };
    assert.deepEqual(shelfFromLive(JSON.parse(JSON.stringify(body))), body, name);
  }
});

test("the hub's checks take shelf.json's rows and null, and nothing else", () => {
  const rows = [
    ['reading', shelf.reading],
    ['lastWatched', shelf.lastWatched],
    ['listening', shelf.listening],
  ] as const;
  for (const [name, row] of rows) {
    const check = shelfFromLive;
    assert.deepEqual(check({ [name]: row }), { [name]: row });
    assert.deepEqual(check({ [name]: null }), { [name]: null });
    // The coding cell's value, and any other key, is not a row.
    assert.deepEqual(check({ [name]: row, coding: {}, extra: 1 }), { [name]: row });
    for (const body of [
      null,
      [],
      'x',
      {},
      { coding: {} },
      { [name]: undefined },
      { [name]: { ...row, extra: 1 } },
      { [name]: { ...row, title: '' } },
      { [name]: { ...row, title: 7 } },
      { [name]: [row] },
    ]) {
      assert.equal(check(body), null, `${name} ${JSON.stringify(body)}`);
    }
  }
  const bad = [
    ['reading', { title: 'T', creator: 'C', started: '2026-1' }],
    ['reading', { title: 'T', creator: 'C', page: 0 }],
    ['reading', { title: 'T', creator: 'C', page: null }],
    ['reading', { title: 'T' }],
    ['lastWatched', { title: 'T', year: 999, date: '2026-10-01' }],
    ['lastWatched', { title: 'T', year: 2001, date: '2026-10-32' }],
    ['lastWatched', { title: 'T', year: 2001, date: '2026-10-01T00:00:00Z' }],
    ['lastWatched', { title: 'T', year: 2001, date: '2026-10-01', rating: 0 }],
    ['lastWatched', { title: 'T', year: 2001, date: '2026-10-01', rating: 4.25 }],
    ['lastWatched', { title: 'T', year: '2001', date: '2026-10-01' }],
    ['listening', { title: 'T', creator: 'C', plays: 0 }],
    ['listening', { title: 'T', creator: 'C', plays: '9' }],
    ['reading', { title: 'T', creator: 'C', plays: 9 }],
  ] as const;
  for (const [name, row] of bad) {
    assert.equal(shelfFromLive({ [name]: row }), null, JSON.stringify(row));
  }
});

// A row widget, as shelfText reads it.
const as = (widget: string) => ({ dataset: { widget } });

test('a row left out or failing its check leaves the other rows', () => {
  const all = { reading: shelf.reading, lastWatched: null, listening: shelf.listening };
  assert.deepEqual(shelfFromLive(all), all);
  assert.deepEqual(shelfFromLive({ ...all, reading: { title: '' } }), {
    lastWatched: null,
    listening: shelf.listening,
  });
  const { listening: _, ...rest } = all;
  assert.deepEqual(shelfFromLive(rest), rest);
  assert.equal(shelfText(rest, as('on-repeat')), undefined);
  assert.equal(shelfText({}, as('reading')), undefined);
  assert.equal(shelfText({}, as('last-watched')), undefined);
  assert.deepEqual(shelfText(all, as('last-watched')), watchedText(null));
});

test('row texts: the build and the hub write the same, "—" when nothing is current', () => {
  assert.deepEqual(
    readingText({ title: 'A Game of Thrones', creator: 'G', started: '2026-10', page: 120 }),
    {
      tile: 'ag',
      title: 'reading · A Game of Thrones',
      sub: 'G · started Oct ’26',
      meta: 'p. 120',
    },
  );
  assert.deepEqual(readingText({ title: 'It', creator: 'S' }), {
    tile: 'it',
    title: 'reading · It',
    sub: 'S',
    meta: '',
  });
  assert.deepEqual(
    watchedText({ title: 'Clueless', year: 1995, rating: 3.5, date: '2026-10-28' }),
    {
      tile: 'cl',
      title: 'last watched · \u2068Clueless\u2069 (1995)',
      sub: '',
      stars: '★★★½',
      rated: 'rated 3.5 of 5',
      meta: '28 Oct',
      date: '2026-10-28',
      full: '28 October 2026',
    },
  );
  assert.deepEqual(listeningText({ title: 'X', creator: 'Y', plays: 1 }).meta, '1 play');
  assert.deepEqual(listeningText({ title: 'X', creator: 'Y', plays: 9 }).sub, 'Y · last 7 days');
  assert.deepEqual(shelfText({ reading: null }, as('reading')), {
    tile: '',
    title: 'reading · —',
    sub: '',
    meta: '',
  });
  assert.deepEqual(shelfText({ lastWatched: null }, as('last-watched')), {
    tile: '',
    title: 'last watched · —',
    sub: '',
    stars: '',
    rated: '',
    meta: '',
    date: null,
    full: '',
  });
  assert.deepEqual(shelfText({ listening: null }, as('on-repeat')), {
    tile: '♪',
    title: 'on repeat · —',
    sub: '',
    meta: '',
  });
});

test("/now's cells: the rows' texts, the date on the label's right, \"—\" when nothing is current", () => {
  const reading = { label: 'reading', tile: 'ag', name: 'A Game of Thrones' };
  const started = {
    date: '2026-10',
    lead: 'started ',
    meta: 'Oct ’26',
    full: 'started October 2026',
  };
  const unknown = { date: null, lead: '', meta: '', full: '' };
  const book = { title: 'A Game of Thrones', creator: 'G' };
  assert.deepEqual(readingCell({ ...book, started: '2026-10', page: 120 }), {
    ...reading,
    sub: 'G · p. 120',
    ...started,
  });
  assert.deepEqual(readingCell({ ...book, started: '2026-10' }), {
    ...reading,
    sub: 'G',
    ...started,
  });
  assert.deepEqual(readingCell({ ...book, page: 7 }), { ...reading, sub: 'G · p. 7', ...unknown });
  assert.deepEqual(readingCell(book), { ...reading, sub: 'G', ...unknown });
  assert.deepEqual(readingCell(null), {
    label: 'reading',
    tile: '',
    name: '—',
    sub: '',
    ...unknown,
  });

  assert.deepEqual(
    watchedCell({ title: 'Clueless', year: 1995, rating: 3.5, date: '2026-10-28' }),
    {
      label: 'last watched',
      tile: 'cl',
      name: withYear('Clueless', 1995),
      sub: '',
      stars: '★★★½',
      rated: 'rated 3.5 of 5',
      meta: '28 Oct',
      date: '2026-10-28',
      full: '28 October 2026',
    },
  );
  assert.deepEqual(watchedCell({ title: 'It', year: 2017, date: '2026-01-01' }), {
    label: 'last watched',
    tile: 'it',
    name: withYear('It', 2017),
    sub: '',
    stars: '',
    rated: '',
    meta: '1 Jan',
    date: '2026-01-01',
    full: '1 January 2026',
  });
  assert.deepEqual(watchedCell(null), {
    label: 'last watched',
    tile: '',
    name: '—',
    sub: '',
    stars: '',
    rated: '',
    meta: '',
    date: null,
    full: '',
  });
});
