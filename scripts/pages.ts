// Reads every page in dist/: the live widgets, /shelf's three live rows and /now's reading and
// last-watched cells show the committed values, none of /now's live widgets is a state fixture,
// client JS (inline scripts and the /_astro/ modules a page loads or imports, gzip each) stays
// within budget, and titles and descriptions are present and unique. HTML and CSS sizes are
// reported, never failed. Run after `bun run build`; exits 1 on a problem.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { contributionsText } from '../src/data/contributions';
import {
  credits,
  listeningText,
  readingCell,
  readingText,
  watchedCell,
  watchedText,
} from '../src/data/shelf-live';

// Client JS gzip per page, as AGENTS.md sets it: 7 KB on /now, 5 KB on every other page.
const budget = (page: string) => (page === 'now/index.html' ? 7168 : 5120);
const problems: string[] = [];
const titles = new Map<string, string>();
const { track, at } = JSON.parse(readFileSync('src/data/snapshots/lastfm.json', 'utf8'));
const coding = JSON.parse(readFileSync('src/data/snapshots/wakatime.json', 'utf8'));
const { reading, lastWatched, listening } = JSON.parse(readFileSync('src/data/shelf.json', 'utf8'));
const calendar = contributionsText(
  JSON.parse(readFileSync('src/data/snapshots/contributions.json', 'utf8')),
);
// A keyless build shows each shelf row once on /shelf; missing shelf.json rows read "—".
const rows = {
  reading: readingText(reading ?? null).title,
  'last-watched': watchedText(lastWatched ?? null).title,
  'on-repeat': listeningText(listening ?? null).title,
};
// /now's reading and last-watched cells show the same values, as the cells name them.
const shelfCells: Record<string, string> = {
  reading: readingCell(reading ?? null).name,
  'last-watched': watchedCell(lastWatched ?? null).name,
};
// gzip(1), not zlib: every earlier measurement used it, and the two differ by a few bytes.
const gz = (input: string | Buffer) =>
  spawnSync('gzip', ['-6', '-c', '-n'], { input }).stdout.length;
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s = '') => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => entities[e]);
const sum = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);
// The element whose start tag begins at `at`, up to the tag that closes it: tags are counted, void
// and self-closed ones skipped. Text holds no "<" (Astro escapes it), so only tags match.
const voids = /^(area|br|col|embed|hr|img|input|link|meta|source|wbr)$/i;
function element(html: string, at: number) {
  let depth = 0;
  for (const tag of html.slice(at).matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*?(\/?)>/gi)) {
    const [, closing, name, selfClosed] = tag;
    if (closing || !(selfClosed || voids.test(name))) {
      depth += closing ? -1 : 1;
    }
    if (depth === 0) {
      return html.slice(at, at + (tag.index ?? 0) + tag[0].length);
    }
  }
  return html.slice(at);
}

function load(page: string, module: string, seen: Map<string, number>) {
  if (!/^\/_astro\/[\w./-]+\.js$/.test(module) || !existsSync(`dist${module}`)) {
    problems.push(`${page} loads ${module}, which is not a file in dist/_astro/`);
  } else if (!seen.has(module)) {
    const code = readFileSync(`dist${module}`);
    seen.set(module, gz(code));
    for (const spec of all(code.toString(), /(?:\bfrom|\bimport\(?)\s*["']([^"']+)["']/g)) {
      load(page, new URL(spec, `https://site.invalid${module}`).pathname, seen);
    }
  }
}

const pages = readdirSync('dist', { recursive: true, encoding: 'utf8' }).filter((p) =>
  p.endsWith('.html'),
);
for (const page of pages.sort()) {
  const html = readFileSync(`dist/${page}`, 'utf8');

  const widgets = all(html, /(<[^>]*\bdata-widget="now-playing"[^>]*>)/g);
  const tracks = all(html, /\bdata-now-playing="track"[^>]*>([^<]*)</g).map(decode);
  const times = all(html, /(<[^>]*\bdata-now-playing="time"[^>]*>)/g);
  const shows =
    widgets.every((w) => attr(w, 'data-state') === 'idle') &&
    tracks.length === widgets.length &&
    tracks.every((t) => t === track) &&
    times.length === widgets.length &&
    times.every((t) => attr(t, 'datetime') === at);
  if (!shows || (page === 'now/index.html' && !widgets.length)) {
    problems.push(`${page}: now-playing widgets do not all show the snapshot`);
  }

  // The coding cell, on /now only: idle, or empty as "—", with the snapshot's time and language,
  // and WakaTime's credit.
  const cells = all(html, /(<[^>]*\bdata-widget="coding"[^>]*>)/g);
  const languages = all(html, /\bdata-coding="language"[^>]*>([^<]*)</g).map(decode);
  const todays = all(html, /\bdata-coding="today"[^>]*>([^<]*)</g).map(decode);
  // Each share's name twice, in the bar's tooltip and then in the legend.
  const mix = all(html, /<[^>]*\bdata-mix-name\b[^>]*>([^<]*)</g)
    .map(decode)
    .filter(Boolean);
  const names: string[] = coding.shares.length
    ? coding.shares.map(({ name }: { name: string }) => name)
    : ['—'];
  const language = coding.today && coding.language ? `top language ${coding.language}` : '';
  const today = coding.today ? `${coding.today} that day` : '—';
  const codes =
    cells.length === (page === 'now/index.html' ? 1 : 0) &&
    cells.every((c) => attr(c, 'data-state') === coding.state) &&
    (!cells.length || html.includes('via wakatime')) &&
    (!cells.length || mix.join('|') === [...names, ...names].join('|')) &&
    languages.length === cells.length &&
    languages.every((l) => l === language) &&
    todays.length === cells.length &&
    todays.every((t) => t === today);
  if (!codes) {
    problems.push(`${page}: the coding cell does not show the snapshot`);
  }

  // The heatmap, on /now only: once, with the snapshot's texts and day, and 371 titled squares.
  const heatmaps = html.split('data-widget="contributions"').length - 1;
  const texts = (row: string) =>
    all(html, new RegExp(`\\bdata-row="${row}"[^>]*>([^<]*)<`, 'g'))
      .map(decode)
      .join('|');
  const updated = all(html, /(<time\b[^>]*\bdata-row="updated"[^>]*>)/g);
  const squares = all(html, /<rect\b[^>]*>(<title>)/g).length;
  const nowPage = page === 'now/index.html';
  const heats =
    heatmaps === Number(nowPage) &&
    (!nowPage ||
      (texts('total') === calendar.total &&
        texts('since') === calendar.since &&
        texts('updated') === calendar.updated &&
        updated.length === 1 &&
        attr(updated[0], 'datetime') === calendar.date &&
        squares === 371));
  if (!heats) {
    problems.push(
      `${page}: the heatmap does not show the snapshot's texts and day and 371 squares once, on /now alone`,
    );
  }

  // Each shelf row once on /shelf, and reading and last watched once more on /now, as cells, and
  // on no other page. Inside the widget's own element, its holder shows the value exactly (the
  // row's title, or the cell's name) and its source is credited, with its link; a cell also
  // links to /shelf.
  for (const [name, title] of Object.entries(rows)) {
    const cell = nowPage && name in shelfCells;
    const shown = page === 'shelf/index.html' || cell;
    const found = [...html.matchAll(new RegExp(`<[a-z][^>]*\\bdata-widget="${name}"`, 'g'))];
    const own = found.length > 0 ? element(html, found[0].index ?? 0) : '';
    const [hook, text] = cell ? ['name', shelfCells[name]] : ['title', title];
    const holders = all(own, new RegExp(`\\bdata-row="${hook}"[^>]*>([^<]*)<`, 'g')).map(decode);
    const credit = credits[name as keyof typeof credits];
    const credited = own.includes(`href="${credit.href}"`) && own.includes(credit.label);
    const ok =
      holders.length === 1 &&
      holders[0] === text &&
      credited &&
      (!cell || own.includes('href="/shelf"'));
    if (found.length !== Number(shown) || (shown && !ok)) {
      const where = name in shelfCells ? '/shelf and once on /now' : '/shelf';
      problems.push(
        `${page}: the ${name} row does not show shelf.json's value, credited, once on ${where}, and on no other page`,
      );
    }
  }

  // The hub skips a widget marked as a state fixture, so none of /now's live widgets may carry one.
  const fixtures = all(html, /(<[a-z][^>]*\bdata-widget="[^"]*"[^>]*>)/g).filter((tag) =>
    /\bdata-fixture\b/.test(tag),
  );
  if (nowPage && fixtures.length > 0) {
    problems.push(
      `${page}: ${fixtures.length} live widget(s) marked data-fixture, which the hub skips`,
    );
  }

  const seen = new Map<string, number>();
  const parts: [string, number][] = [];
  let data = 0;
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = attr(attrs, 'src');
    if (src) {
      load(page, src, seen);
    } else if (/json/i.test(attr(attrs, 'type') ?? '')) {
      data += gz(body); // JSON-LD never runs
    } else {
      parts.push(['inline', gz(body)]);
    }
  }
  parts.push(...[...seen].map(([m, size]): [string, number] => [m.slice('/_astro/'.length), size]));
  const js = sum(parts.map(([, size]) => size));
  // inlineStylesheets: 'always' puts all CSS in <style>; a <noscript> one never applies with JS on.
  const styled = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const css = sum(all(styled, /<style\b[^>]*>([\s\S]*?)<\/style>/g).map(gz));
  const size = gz(Buffer.from(html));
  const report = [
    `${page}: JS ${js} B, ${budget(page) - js} B left (${parts.map((p) => p.join(' ')).join(', ')})`,
    `HTML ${size} B`,
    `CSS ${css} B`,
  ];
  if (data) {
    report.push(`JSON data ${data} B, not JS`);
  }
  if (size > 30 * 1024 || css > 12 * 1024) {
    report.push('over the 30 KB HTML / 12 KB CSS target');
  }
  console.log(report.join('; '));
  if (js > budget(page)) {
    problems.push(`${page}: ${js} B of JS gzip, over ${budget(page)} B`);
  }

  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1]).trim();
  const meta = /<meta\b[^>]*\bname="description"[^>]*>/.exec(html)?.[0] ?? '';
  const description = decode(attr(meta, 'content')).trim();
  for (const [kind, value] of [
    ['title', title],
    ['description', description],
  ]) {
    const other = titles.get(`${kind} ${value}`);
    if (!value || other) {
      problems.push(`${page}: ${value ? `same ${kind} as ${other}` : `no ${kind}`}`);
    }
    titles.set(`${kind} ${value}`, page);
  }
}
if (!pages.length) {
  problems.push('dist/ has no pages; run `bun run build` first');
}
for (const problem of problems) {
  console.error(problem);
}
process.exitCode = problems.length ? 1 : 0;
