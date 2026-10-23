// NFR-X3 guard: the theme restore is the only inline script (D53), and the one
// Content-Security-Policy in public/_headers, on the /* rule, must allow scripts from exactly 'self'
// and the restore's hash as built. With a stale hash the browser blocks the restore; theme.ts
// applies a stored theme only after parsing, so pages can paint in the wrong one first (FR-SH-3).
// Run `bun scripts/csp-hash.ts` after `bun run build`. It reads every page in dist/, prints every
// problem it finds and exits 1 if there is one.
// ponytail: pages are read with Bun's HTMLRewriter (lol-html), which tokenises as browsers do but
// builds no tree, so a <template> is refused rather than placed. Attributes are not read: the policy
// blocks inline handlers, javascript: URLs and srcdoc scripts, and no page uses one. The policy may
// use only the directives in `known`. Use a DOM and a CSP parser if a page or the policy needs more.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

type Element = { getAttribute(name: string): string | null; namespaceURI: string };
type Handlers = { element?(element: Element): void; text?(chunk: { text: string }): void };
type Rewriter = {
  on(selector: string, handlers: Handlers): Rewriter;
  transform(r: Response): Response;
};
declare const HTMLRewriter: new () => Rewriter;

const dist = new URL('../dist/', import.meta.url);
const pages = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) =>
  file.endsWith('.html'),
);
if (!pages.length) {
  throw new Error('dist/ has no pages; run `bun run build` first');
}
const problems: string[] = [];

// Scripts run in HTML and SVG, not in MathML. A script with a src attribute is a file under 'self',
// and a data block (a type whose essence ends in json, such as JSON-LD) never runs. The browser
// hashes a script's text after turning CRLF and CR into LF and NUL into U+FFFD.
const runs = new Set(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg']);
async function read(page: string): Promise<string[]> {
  const scripts: { text: string }[] = [];
  let script: { text: string } | undefined;
  await new HTMLRewriter()
    .on('template', {
      element: () => problems.push(`${page} has a <template>, which the guard refuses`),
    })
    .on('script', {
      element(element) {
        const type = element.getAttribute('type')?.split(';')[0].trim() ?? '';
        const inline =
          runs.has(element.namespaceURI) &&
          element.getAttribute('src') === null &&
          !/json$/i.test(type);
        script = inline ? { text: '' } : undefined;
        if (script) {
          scripts.push(script);
        }
      },
      text(chunk) {
        if (script) {
          script.text += chunk.text;
        }
      },
    })
    .transform(new Response(readFileSync(new URL(page, dist), 'utf8').replace(/\r\n?/g, '\n')))
    .text();
  return scripts.map(({ text }) => text.replaceAll('\u0000', String.fromCodePoint(0xfffd)));
}

const built = new Map<string, string[]>();
for (const page of pages) {
  const inline = await read(page);
  if (inline.length !== 1) {
    problems.push(`${page} has ${inline.length} inline scripts; D53 allows only the restore`);
    continue;
  }
  const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`;
  built.set(hash, [...(built.get(hash) ?? []), page]);
}
if (built.size > 1) {
  problems.push(`pages differ in the restore: ${JSON.stringify(Object.fromEntries(built))}`);
}

// public/_headers as Pages reads it (workers-sdk parseHeaders, pages-shared metadata): blank and #
// lines are skipped and lines over 2,000 characters ignored; a rule starts at a path or an https URL
// (normalised; more than one * makes it invalid) and is dropped if it sets nothing; once 100 rules
// are kept the rest of the file is ignored, the open rule apart; the same header twice in a rule is
// joined with a comma; a later rule with the same path replaces an earlier one.
type Rule = { path: string; headers: Map<string, string>; unset: string[] };
function normalise(token: string): string | undefined {
  const absolute = /^https:\/\/+([^/]+)\/?(.*)/.exec(token);
  if ((absolute && /:\d+$/.test(absolute[1])) || (!absolute && !token.startsWith('/'))) {
    return undefined;
  }
  const pathname = new URL(`//${absolute ? `/${absolute[2]}` : token}`, 'relative://').pathname;
  const path = `${absolute ? `https://${absolute[1]}` : ''}${pathname}`;
  return (path.match(/\*/g) ?? []).length < 2 ? path : undefined;
}
const kept: Rule[] = [];
let rule: Rule | undefined;
function keep() {
  if (rule && (rule.headers.size || rule.unset.length)) {
    kept.push(rule);
  }
}
for (const line of readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trim())) {
  if (!line || line.startsWith('#') || line.length > 2000) {
    continue;
  }
  if (/^(\S+:\/\/|\/)/.test(line)) {
    if (kept.length >= 100) {
      break;
    }
    keep();
    const path = normalise(line);
    rule = path === undefined ? undefined : { path, headers: new Map(), unset: [] };
    continue;
  }
  const colon = line.indexOf(':');
  const name = line.slice(0, colon).trim().toLowerCase();
  const value = line.slice(colon + 1).trim();
  if (rule && colon < 0) {
    if (line.startsWith('! ')) {
      rule.unset.push(line.slice(2).trim().toLowerCase());
    }
  } else if (rule && name && !name.includes(' ') && value) {
    const before = rule.headers.get(name);
    rule.headers.set(name, before ? `${before}, ${value}` : value);
  }
}
keep();
const rules = new Map(kept.map((r) => [r.path, r]));
const csp = 'content-security-policy';
for (const r of rules.values()) {
  if (r.unset.includes(csp)) {
    problems.push(`${r.path} detaches the Content-Security-Policy`);
  }
  if (r.headers.has(csp) && r.path !== '/*') {
    problems.push(`${r.path} sets a Content-Security-Policy; only /* may`);
  }
}

// One policy (a comma would start a second), printable ASCII, no repeated directive (browsers keep
// the first), and only directives that cannot stop the restore or the /_astro modules.
const policy = rules.get('/*')?.headers.get(csp) ?? '';
if (!policy) {
  problems.push('no Content-Security-Policy reaches /*');
} else if (/[^\x20-\x7e]|,/.test(policy)) {
  problems.push('the policy has a comma or a character outside printable ASCII');
}
const known = new Set([
  ...['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src'],
  ...['media-src', 'object-src', 'frame-src', 'child-src', 'worker-src', 'manifest-src'],
  ...['base-uri', 'form-action', 'frame-ancestors', 'upgrade-insecure-requests'],
]);
const directives = new Map<string, string[]>();
for (const [name, ...sources] of policy.split(';').map((d) => d.trim().split(/ +/))) {
  const key = name.toLowerCase();
  if (directives.has(key)) {
    problems.push(`the policy repeats ${name}`);
  } else if (key && !known.has(key)) {
    problems.push(`the policy uses ${name}, which the guard refuses`);
  } else if (key) {
    directives.set(key, sources);
  }
}
const [expected] = built.keys();
const sources = directives.get('script-src') ?? [];
const hashes = sources.filter((source) => source.startsWith("'sha256-"));
if (sources.length !== 2 || !sources.includes("'self'") || hashes.length !== 1) {
  problems.push(`script-src must be exactly 'self' and one hash; found ${sources.join(' ')}`);
} else if (built.size === 1 && hashes[0] !== expected) {
  problems.push(`script-src lists ${hashes[0]}; the build needs ${expected}`);
}

for (const problem of problems) {
  console.error(problem);
}
if (!problems.length) {
  console.log(`script-src matches the theme restore on ${pages.length} pages: ${expected}`);
}
process.exitCode = problems.length ? 1 : 0;
