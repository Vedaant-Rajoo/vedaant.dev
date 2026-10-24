// Reads every page in dist/: now-playing widgets show the committed snapshot, client JS (inline
// scripts and the /_astro/ modules a page loads or imports, gzip each) stays within budget, and
// titles and descriptions are present and unique. HTML and CSS sizes are reported, never failed.
// Run after `bun run build`; exits 1 on a problem.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const BUDGET = 5120;
const problems: string[] = [];
const titles = new Map<string, string>();
const { track, at } = JSON.parse(readFileSync('src/data/snapshots/lastfm.json', 'utf8'));
// gzip(1), not zlib: every earlier measurement used it, and the two differ by a few bytes.
const gz = (input: string | Buffer) =>
  spawnSync('gzip', ['-6', '-c', '-n'], { input }).stdout.length;
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s = '') => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => entities[e]);
const sum = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);

// Adds a module and every module it imports, as Vite writes them, to `seen`.
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
    `${page}: JS ${js} B, ${BUDGET - js} B left (${parts.map((p) => p.join(' ')).join(', ')})`,
  ];
  report.push(`HTML ${size} B`, `CSS ${css} B`);
  if (data) {
    report.push(`JSON data ${data} B, not JS`);
  }
  if (size > 30 * 1024 || css > 12 * 1024) {
    report.push('over the 30 KB HTML / 12 KB CSS target');
  }
  console.log(report.join('; '));
  if (js > BUDGET) {
    problems.push(`${page}: ${js} B of JS gzip, over ${BUDGET} B`);
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
