#!/bin/sh
# The local quality gate (S29, D19): `bun run gate` runs these steps in order and stops at the first
# that fails, with a non-zero exit. It builds dist/ with the network blocked and measures that
# build, so run it after `bun install --frozen-lockfile` (D73) and not while a preview serves dist/.
# It shows no tool output, which can quote any source line or page: a step that fails names the
# command to run alone for its output. The gate's own lines name steps, rules, files and numbers,
# never text from a page or source line, and pass through mask.
# ponytail: the offline build uses macOS's sandbox-exec (deprecated, still shipped). A Linux job
# (S30c) needs another block, such as `unshare -n`, or NODE_USE_ENV_PROXY=1 with an unreachable
# HTTPS_PROXY for fetch alone.
#
# On demand, not in the gate (D19). The versions are pinned so a rerun measures the same way; each
# report records its Chrome. astro preview ignores public/_headers, so serve dist/ with the Pages
# runtime, then audit /, /now/, /projects/, /writing/, each post, and /does-not-exist for the 404
# page (Lighthouse refuses a 404 status, so it audits /404 instead):
#   WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npx wrangler@4.150.0 pages dev dist \
#     --ip 127.0.0.1 --port 4322 --inspector-port 9322
#   npx lighthouse@13.5.0 http://127.0.0.1:4322/ --form-factor=mobile --output=json --output=html
#     (and --throttling-method=devtools for applied throttling)
#   npx @axe-core/cli@4.14.0 http://127.0.0.1:4322/ --exit \
#     --chrome-options=headless=new,blink-settings=preferredColorScheme=1 (0 for dark)
#     (its bundled chromedriver is 152; add --chromedriver-path for the installed Chrome's)
set -euf
# Every command's own messages are hidden, since they can name a file, the checkout or the
# temporary directory, and any of them can hold a secret: errors go to /dev/null until the
# temporary directory exists, then to a file there that is never shown. The gate's own lines use
# fd 3, the original stderr. cd prints the directory it enters when CDPATH is set, so it has none.
exec 3>&2 2> /dev/null
unset CDPATH
cd "$(dirname "$0")/.." > /dev/null || {
  echo 'gate: FAIL: cannot enter the repository' >&3
  exit 1
}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX") || {
  echo 'gate: FAIL: mktemp could not make a temporary directory' >&3
  exit 1
}
trap 'rm -rf "$tmp"' EXIT
# An interrupt exits through the EXIT trap too, so no log or key copy is left behind.
trap 'exit 1' HUP INT TERM
exec 2> "$tmp/stderr"
step() { printf '\ngate: %s\n' "$*"; }
fail() {
  printf 'gate: FAIL: %s\n' "$*" >&3
  exit 1
}
# The token formats the secret scan looks for (step 5), one per line: the rule, then an ERE.
formats='private-key -----BEGIN[A-Z ]*PRIVATE KEY
github-token gh[oprsu]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}
aws-key A(KIA|SIA)[0-9A-Z]{16}
slack-token xox[abeoprs]-[A-Za-z0-9-]{10,}
stripe-key [rs]k_live_[0-9A-Za-z]{16,}
google-key AIza[0-9A-Za-z_-]{35}
jwt eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*'
printf '%s\n' "$formats" > "$tmp/formats"
# The masks are those formats joined with |, built in the shell, where no tool failure can hide.
masks=
while read -r rule format; do masks="${masks:+$masks|}$format"; done < "$tmp/formats"
[ -n "$masks" ] || fail 'cannot build the masks'
# A file name can hold a secret, so the lines that name files are printed through mask: it hides
# those formats, every line of a private key block (to the end when it has no END line), 32-hex
# words (D92's key is one), api_key values and runs of 60 or more base64 characters in a file, and
# prints nothing unless sed succeeded.
mask() {
  sed -E -e "/-----BEGIN[A-Z ]*PRIVATE KEY/,/-----END[A-Z ]*PRIVATE KEY/s#.*#<masked>#" \
    -e "s#$masks#<masked>#g; s#[0-9A-Fa-f]{32}#<32 hex>#g" \
    -e "s#(api_key=)[^&[:space:]\"]*#\\1<masked>#g; s#[A-Za-z0-9+/]{60,}#<masked>#g" \
    "$1" > "$tmp/masked" || fail 'sed could not mask a report'
  cat "$tmp/masked"
}
# Runs a tool with its output saved, not shown; fails the gate, naming the step, if the tool fails.
run() {
  name=$1
  shift
  "$@" < /dev/null > "$tmp/$name.log" 2>&1 ||
    fail "$name; its output is not shown, so run the step's command alone to see it"
}
# Runs one of the gate's own readers (written below) and shows its report through mask; fails the
# gate if the reader fails.
report() {
  name=$1
  shift
  status=0
  "$@" < /dev/null > "$tmp/$name.log" 2>&1 || status=$?
  mask "$tmp/$name.log"
  [ "$status" -eq 0 ] || fail "$name"
}
# Counts the lines (-l) or bytes (-c) of a file into $count. The number goes through a file: in a
# command substitution, a failing wc would not stop the gate.
size() {
  wc "$1" < "$2" > "$tmp/count" || fail 'wc failed'
  read -r count < "$tmp/count"
}
# grep, except that an error (exit 2) fails the gate instead of reading as no match: list prints
# what matches and succeeds either way. grep's own error names a file, so it is not shown.
list() { grep "$@" 2> "$tmp/grep.err" || [ $? -eq 1 ] || fail 'grep could not read its input'; }

step '1/8 bun run check'
run check bun run check
grep -q '^Result (' "$tmp/check.log" ||
  fail 'astro check printed no Result line, so it type-checked nothing (D73)'

step '2/8 bun test'
run test bun test

step '3/8 bun run build with every remote host unreachable (NFR-L1)'
command -v sandbox-exec > /dev/null || fail 'the offline build needs sandbox-exec (macOS)'
# Outbound connections are refused except to this machine, where astro build opens a socket.
offline='(version 1)(allow default)(deny network-outbound (remote ip))'
offline="$offline"'(allow network-outbound (remote ip "localhost:*"))'
run build sandbox-exec -p "$offline" bun run build
# lastfm.ts warns once when it falls back; Astro may print a page path before it on the same line.
# The count goes through a file: in a command substitution, a grep error would not stop the gate.
list -c 'lastfm:' "$tmp/build.log" > "$tmp/count"
read -r count < "$tmp/count"
[ "$count" -eq 1 ] || fail 'the build did not fall back to the snapshot exactly once'
echo 'The build fell back to the committed Last.fm snapshot once.'
# With JS off, every now-playing widget shows the committed value (#7). Pages are read with Bun's
# HTML parser, as in step 4, which returns attribute values and text as written; decode.mjs reads
# them as a browser does.
cat > "$tmp/decode.mjs" << 'EOF'
// An attribute value or text as a browser reads it, or undefined when it holds a character
// reference this does not decode: it knows numeric references and five names, the ones Astro
// writes, so anything else is reported rather than guessed. HTML replaces some numeric
// references instead of decoding them (0, 0x80–0x9F, surrogates, past U+10FFFF); those are
// reported too.
const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const reference = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|(amp|AMP|lt|LT|gt|GT|quot|QUOT|apos));/g;
const replaced = (point) =>
  point === 0 ||
  (point >= 0x80 && point <= 0x9f) ||
  (point >= 0xd800 && point <= 0xdfff) ||
  point > 0x10ffff;
// A page as a browser's parser reads it: CRLF and CR become LF, and a NUL, which it drops or
// replaces depending on where it stands, makes the page undefined, to be reported.
export function page(bytes) {
  const text = bytes.toString('utf8');
  return text.includes('\0') ? undefined : text.replace(/\r\n?/g, '\n');
}
export function decode(raw) {
  let decodable = !/&[#\w]/.test(raw.replace(reference, ''));
  const value = raw.replace(reference, (_, decimal, hex, name) => {
    if (name) {
      return names[name.toLowerCase()];
    }
    const point = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    if (replaced(point)) {
      decodable = false;
      return '';
    }
    return String.fromCodePoint(point);
  });
  return decodable ? value : undefined;
}
EOF
cat > "$tmp/widgets.mjs" << 'EOF'
// Every now-playing widget in dist/ is idle and holds exactly one track holder, whose text is the
// snapshot's track, and exactly one time holder, whose datetime is the snapshot's time; no holder
// sits outside a widget, and / and /now/ have one. It prints pages and counts, never page text.
// lol-html builds no tree, so ownership is checked only on markup whose tree the tags fix: the
// widget is an HTML <a> or <div>, no holder, and not inside a <template>; inside it, only HTML
// elements in `inside` (none of them ends an open element by starting), each closed by its own end
// tag, in order. Anything else is reported as markup the check cannot follow.
import { readdirSync, readFileSync } from 'node:fs';
import { decode, page as parsed } from './decode.mjs';

const html = 'http://www.w3.org/1999/xhtml';
const roots = new Set(['a', 'div']);
const inside = new Set(['span', 'bdi', 'time', 'img']);
const shows = (widget) =>
  widget.state === 'idle' &&
  widget.tracks.length === 1 &&
  widget.tracks[0] === track &&
  widget.times.length === 1 &&
  widget.times[0] === at;
const problems = [];
const widgets = {};
let page;
let track;
let at;
try {
  // Inside the try: a parse error can quote the file.
  ({ track, at } = JSON.parse(readFileSync('src/data/snapshots/lastfm.json', 'utf8')));
  if (!track || !at) {
    problems.push('src/data/snapshots/lastfm.json has no track or time');
  }
  const pages = readdirSync('dist', { recursive: true, encoding: 'utf8' });
  for (page of pages.filter((path) => path.endsWith('.html')).sort()) {
    const found = [];
    // The raw text of the text node being read.
    let node = '';
    // The elements open in the current widget, the widget first.
    const open = [];
    // How many <template> elements are open: their content is inert.
    let inert = 0;
    const issues = new Set();
    const cannot = 'now-playing markup the check cannot follow';
    const text = parsed(readFileSync(`dist/${page}`));
    if (text === undefined) {
      issues.add('a NUL character, which the check does not follow');
    }
    const value = (element, name) => {
      const raw = element.getAttribute(name);
      const decoded = raw === null ? null : decode(raw);
      if (decoded === undefined) {
        issues.add('a character reference the check cannot decode');
      }
      return decoded ?? raw;
    };
    const opened = (element) => {
      const tag = element.tagName;
      const entry = { tag, track: value(element, 'data-now-playing') === 'track' };
      open.push(entry);
      // An end tag that closes another element as well reaches this one's handler with its name.
      element.onEndTag((end) => {
        if (end.name !== tag || open.at(-1) !== entry) {
          issues.add(cannot);
        }
        const index = open.lastIndexOf(entry);
        if (index >= 0) {
          open.splice(index);
        }
      });
    };
    // Outside a widget, a holder is stray and a widget opens.
    const outside = (element, widget, holder) => {
      if (element.tagName === 'template' && !element.selfClosing) {
        inert++;
        element.onEndTag(() => {
          inert--;
        });
      }
      if (holder !== null && !widget) {
        issues.add('a now-playing holder outside a widget');
      }
      if (widget) {
        const plain = roots.has(element.tagName) && element.namespaceURI === html && !inert;
        if (holder !== null || !plain || element.selfClosing) {
          issues.add(cannot);
        }
        found.push({ state: value(element, 'data-state'), tracks: [], times: [] });
        opened(element);
      }
    };
    const within = (element, widget, holder) => {
      const content = element.canHaveContent;
      const plain = inside.has(element.tagName) && element.namespaceURI === html;
      if (widget || !plain || (content && element.selfClosing)) {
        issues.add(cannot);
      }
      if (holder === 'track') {
        found.at(-1).tracks.push('');
      } else if (holder === 'time') {
        found.at(-1).times.push(value(element, 'datetime'));
      }
      if (content && !element.selfClosing) {
        opened(element);
      }
    };
    await new HTMLRewriter()
      .on('*', {
        element(element) {
          const widget = value(element, 'data-widget') === 'now-playing';
          const holder = value(element, 'data-now-playing');
          (open.length ? within : outside)(element, widget, holder);
        },
      })
      .onDocument({
        // A browser decodes each text node on its own, so references never join across elements:
        // each node is decoded when its last chunk arrives, then added to the track as text.
        text(chunk) {
          node += chunk.text;
          if (chunk.lastInTextNode) {
            const tracks = found.at(-1)?.tracks;
            if (open.some((entry) => entry.track)) {
              const text = decode(node);
              tracks[tracks.length - 1] = text === undefined ? null : tracks.at(-1)?.concat(text);
            }
            node = '';
          }
        },
      })
      .transform(new Response(text ?? ''))
      .text();
    if (open.length) {
      issues.add(cannot);
    }
    if (!found.every(shows)) {
      issues.add('a now-playing widget that does not show the snapshot');
    }
    widgets[page] = found.length;
    for (const issue of issues) {
      problems.push(`dist/${page} has ${issue}`);
    }
  }
} catch (error) {
  // A parser's message can quote the page, so only the kind of error is printed.
  problems.push(`dist/${page ?? ''}: the widget check stopped (${error?.name ?? 'error'})`);
}
for (const home of ['index.html', 'now/index.html']) {
  if (!widgets[home]) {
    problems.push(`dist/${home} has no now-playing widget`);
  }
}
const counts = Object.entries(widgets).filter(([, count]) => count);
console.log(counts.map(([path, count]) => `${path}: ${count} now-playing widget(s)`).join('; '));
for (const problem of problems) {
  console.error(problem);
}
process.exitCode = problems.length ? 1 : 0;
EOF
report widgets bun "$tmp/widgets.mjs"

step '4/8 client JS per page, at most 5,120 B gzip (NFR-P4); HTML and CSS sizes (NFR-P5)'
# NFR-P5 is reported against 30 KB and 12 KB, which p07 tracks but does not gate. Pages are read
# with Bun's HTML parser (lol-html, as in scripts/csp-hash.ts) and modules with its import scanner,
# so this step is JavaScript, run with bun from the temp directory against dist/ here.
cat > "$tmp/budget.mjs" << 'EOF'
// A page's JS is every inline script that runs, as scripts/csp-hash.ts reads them, plus every
// module it loads (<script src>, modulepreload) and the modules those import, each file counted
// once; JSON data blocks such as JSON-LD are reported apart. Sizes are `gzip -6 -c -n` of each file
// on its own, the method of every earlier measurement. It prints pages, /_astro/ file names and
// numbers, never a URL or text from a page, and exits 1 if a page is over budget or loads what it
// cannot count: a file from outside dist/_astro/, a missing file, an import it cannot resolve.
// ponytail: an import() of a computed specifier, a worker and a CSS @import are not followed, and
// Vite emits none of them; count them if a build ever does.
// Not counted either, since the CSP blocks them: event-handler attributes, javascript: URLs and
// the scripts of an iframe's srcdoc, which inherits the page's policy.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { decode, page as parsed } from './decode.mjs';

const BUDGET = 5120;
const dist = new URL('dist/', `file://${process.cwd()}/`);
const origin = 'https://site.invalid';
const imports = new Bun.Transpiler({ loader: 'js' });
const problems = [];
const sum = (sizes) => sizes.reduce((total, size) => total + size, 0);

// An error whose message is the reader's own; any other error's message can quote a page or a
// module, so only its kind is printed.
class Stop extends Error {}

// gzip's size for some bytes, once per distinct content; `what` names them in an error.
const sizes = new Map();
function gz(what, bytes) {
  const key = Buffer.from(bytes).toString('latin1');
  if (!sizes.has(key)) {
    const out = spawnSync('gzip', ['-6', '-c', '-n'], { input: bytes });
    if (out.status !== 0 || !out.stdout?.length) {
      throw new Stop(`gzip failed on ${what}`);
    }
    sizes.set(key, out.stdout.length);
  }
  return sizes.get(key);
}
const text = (what, value) => gz(what, new TextEncoder().encode(value));
const file = (path) => gz(path, readFileSync(new URL(`.${path}`, dist)));

// The dist/_astro/ file of this type that a URL resolves to, or undefined: a URL that does not
// parse, another origin or path, or a file that is not there.
function astro(href, base, type) {
  const url = URL.canParse(href, base) ? new URL(href, base) : undefined;
  const name = new RegExp(`^/_astro/(?:[\\w-]+/)*[\\w.-]+\\.${type}$`);
  const path = url?.origin === origin && name.test(url.pathname) ? url.pathname : undefined;
  return path && existsSync(new URL(`.${path}`, dist)) ? path : undefined;
}

async function read(page) {
  const found = { inline: [], data: [], modules: [], css: [], styles: [] };
  const text = parsed(readFileSync(new URL(page, dist)));
  if (text === undefined) {
    problems.push(`${page} has a NUL character, which the reader does not follow`);
  }
  const base = new URL(page, `${origin}/`);
  // Attribute values as a browser reads them; one this cannot decode makes the page a problem.
  const value = (element, name) => {
    const raw = element.getAttribute(name);
    const decoded = raw === null ? null : decode(raw);
    if (decoded === undefined) {
      problems.push(`${page} has a character reference the reader cannot decode`);
    }
    return decoded ?? raw;
  };
  const add = (href, into, type) => {
    const path = href === null ? undefined : astro(href, base, type);
    if (path) {
      into.push(path);
    } else {
      problems.push(`${page} loads a .${type} file that is not in dist/_astro/`);
    }
  };
  // Scripts run in HTML and SVG, not MathML; a type whose essence ends in json is a data block.
  const runs = ['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg'];
  let script;
  await new HTMLRewriter()
    .on('script', {
      element(element) {
        const type = value(element, 'type')?.split(';')[0].trim() ?? '';
        script = undefined;
        if (!runs.includes(element.namespaceURI)) {
          return;
        }
        // An HTML script loads from src, an SVG one from href or xlink:href.
        const from = element.namespaceURI === runs.at(-1) ? ['href', 'xlink:href'] : ['src'];
        const url = from.find((name) => element.getAttribute(name) !== null);
        if (url) {
          add(value(element, url), found.modules, 'js');
        } else {
          script = /json$/i.test(type) ? found.data : found.inline;
          script.push('');
        }
      },
      text(chunk) {
        if (script) {
          script[script.length - 1] += chunk.text;
        }
      },
    })
    .on('style', {
      element() {
        found.styles.push('');
      },
      text(chunk) {
        found.styles[found.styles.length - 1] += chunk.text;
      },
    })
    // A <base> element would change where every URL on the page resolves.
    .on('base', {
      element() {
        problems.push(`${page} has a <base> element, which the reader does not follow`);
      },
    })
    .on('link', {
      element(element) {
        // rel and as are ASCII case-insensitive.
        const rel = (value(element, 'rel') ?? '').toLowerCase().split(/\s+/);
        const as = (value(element, 'as') ?? '').toLowerCase();
        const preload = rel.includes('preload') && as === 'script';
        if (rel.includes('stylesheet')) {
          add(value(element, 'href'), found.css, 'css');
        } else if (rel.includes('modulepreload') || preload) {
          add(value(element, 'href'), found.modules, 'js');
        }
      },
    })
    .transform(new Response(text ?? ''))
    .text();
  return found;
}

// Adds every module some code imports, statically or with import(), and theirs, to `seen`. A
// browser resolves only a URL or a path starting with /, ./ or ../; a bare specifier such as
// "b.js" needs an import map, which the site does not have.
const source = (module) => readFileSync(new URL(`.${module}`, dist), 'utf8');
const resolvable = /^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i;
function follow(page, code, base, seen) {
  for (const { path } of imports.scanImports(code)) {
    const module = resolvable.test(path) ? astro(path, base, 'js') : undefined;
    if (!module) {
      problems.push(`${page} imports a file that is not in dist/_astro/`);
    } else if (!seen.has(module)) {
      seen.add(module);
      follow(page, source(module), new URL(module, origin), seen);
    }
  }
}

const pages = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.html'))
  .sort();
let over = 0;
let page;
try {
  if (!pages.length) {
    throw new Stop('dist/ has no pages; run `bun run build` first');
  }
  for (page of pages) {
    const found = await read(page);
    const seen = new Set(found.modules);
    for (const module of found.modules) {
      follow(page, source(module), new URL(module, origin), seen);
    }
    for (const script of found.inline) {
      follow(page, script, new URL(page, `${origin}/`), seen);
    }
    const parts = [
      ...found.inline.map((script) => ['inline', text(`an inline script on ${page}`, script)]),
      ...[...seen].map((module) => [module.slice('/_astro/'.length), file(module)]),
    ];
    const js = sum(parts.map(([, size]) => size));
    const html = gz(page, readFileSync(new URL(page, dist)));
    const css =
      sum([...new Set(found.css)].map(file)) +
      sum(found.styles.map((style) => text(`a <style> on ${page}`, style)));
    over += js > BUDGET ? 1 : 0;
    const list = parts.map((part) => part.join(' ')).join(', ');
    const report = [`${page}: JS ${js} B, ${BUDGET - js} B left (${list})`];
    report.push(`HTML ${html} B`, `CSS ${css} B`);
    if (found.data.length) {
      const data = sum(found.data.map((block) => text(`a data block on ${page}`, block)));
      report.push(`JSON data ${data} B, not JS`);
    }
    if (html > 30 * 1024 || css > 12 * 1024) {
      report.push('over the NFR-P5 target');
    }
    console.log(report.join('; '));
  }
} catch (error) {
  problems.push(
    error instanceof Stop
      ? error.message
      : `${page}: the reader stopped (${error?.name ?? 'error'})`,
  );
}
for (const problem of new Set(problems)) {
  console.error(problem);
}
if (over) {
  console.error(`${over} page(s) over ${BUDGET} B of JS gzip`);
}
process.exitCode = over || problems.length ? 1 : 0;
EOF
report budget bun "$tmp/budget.mjs"

step '5/8 no secret in dist/ (NFR-X1)'
# Each rule (formats, above) names a token format; the scan prints the rule and the file, never the
# text. Binary files (fonts, the résumé) are skipped. A secret Astro inlined from the environment
# has no format to look for, so env-read (below) limits how code in src/ reads the environment.
found=0
flag() {
  printf 'gate: %s in %s\n' "$1" "$2" > "$tmp/line"
  mask "$tmp/line" >&3
  found=1
}
scan() {
  list -rlIE -- "$2" dist > "$tmp/hits"
  while read -r file; do flag "$1" "$file"; done < "$tmp/hits"
}
while read -r rule format; do scan "$rule" "$format"; done < "$tmp/formats"
scan env-literal 'import\.meta\.env'
# A 32-hex word has the shape of a Last.fm key or shared secret. The one allowed is the public key
# in src/data/now-playing.ts (D92), read here and never printed, and only in one /_astro/ module.
sed -n "s/^const apiKey = '\\([0-9a-f]\\{32\\}\\)';.*/\\1/p" src/data/now-playing.ts > "$tmp/key" ||
  fail 'cannot read the public key in src/data/now-playing.ts'
size -c "$tmp/key"
[ "$count" -eq 33 ] || fail 'cannot read the public key in src/data/now-playing.ts'
list -rlIwE '[0-9A-Fa-f]{32}' dist > "$tmp/hits"
while read -r file; do
  list -owE '[0-9A-Fa-f]{32}' "$file" > "$tmp/words"
  list -vxF -f "$tmp/key" "$tmp/words" > "$tmp/others"
  [ ! -s "$tmp/others" ] || flag hex-32 "$file"
done < "$tmp/hits"
list -rlF -f "$tmp/key" dist > "$tmp/holders"
size -l "$tmp/holders"
while read -r file; do
  case $file in
    dist/_astro/*.js) [ "$count" -eq 1 ] || flag public-key-twice "$file" ;;
    *) flag public-key-outside-a-module "$file" ;;
  esac
done < "$tmp/holders"
# env-read: code in src/ may read the environment only as import.meta.env.<one of Astro's own
# names>, whole on one line, or through astro:env (AGENTS.md). The rule reads lines, so it flags
# every form it cannot judge: import followed by anything but an import statement's or call's
# next token (so any other import.meta, split, commented or optional), any mention of process,
# Bun or Deno (src/ has none, and destructuring or aliasing them hides every later read),
# globalThis[…] and an import of bun. The allowed form is removed, one at a time, before looking.
# It guards against an accidental read, not deliberate evasion: code can still reach a secret in
# ways no line rule sees (reading a .env file, eval, a dependency that reads the environment), so
# NFR-X1 also rests on review and on the build environment holding no secret (D92: none today).
cat > "$tmp/reads" << 'EOF'
\bimport([^A-Za-z_$\{*'"([:space:]]|$)
\bimport[[:space:]]+([^A-Za-z_$\{*'"([:space:]]|$)
\b(process|Bun|Deno)\b
\bglobalThis[[:space:]]*\[
["']bun["']
EOF
list -rnE --include='*.astro' --include='*.[cm]js' --include='*.js' --include='*.jsx' \
  --include='*.[cm]ts' --include='*.ts' --include='*.tsx' -f "$tmp/reads" src > "$tmp/env"
allowed='(^|[^A-Za-z0-9_$.])import\.meta\.env\.(ASSETS_PREFIX|BASE_URL|DEV|MODE|PROD|SITE|SSR)'
sed -E -e ':a' -e "s/$allowed([^A-Za-z0-9_\$]|\$)/\\1\\3/" -e 'ta' "$tmp/env" > "$tmp/env-rest" ||
  fail 'sed could not read the env lines'
list -E -f "$tmp/reads" "$tmp/env-rest" > "$tmp/reads-left"
while read -r hit; do
  rest=${hit#*:}
  flag env-read "${hit%%:*}:${rest%%:*}"
done < "$tmp/reads-left"
[ "$found" -eq 0 ] || fail 'the secret scan (read secrets through astro:env/server, AGENTS.md)'

step '6/8 bun scripts/csp-hash.ts: the CSP allows the theme restore as built (NFR-X3)'
run csp-hash bun scripts/csp-hash.ts

step '7/8 bun scripts/contrast.ts: contrast in both themes (NFR-A4)'
run contrast bun scripts/contrast.ts

step '8/8 colours only in tokens.css (FR-CM-3)'
# Content quotes colours on purpose (src/content/ only). The theme-color metas in Base.astro
# repeat the --c-bg hex (D28): a line there that starts with <meta name="theme-color" content="#…"
# may hold that one colour and no other.
hex='#[0-9a-f]{3,8}\b'
meta='^src/layouts/Base\.astro:[0-9]+:[[:space:]]*<meta name="theme-color" '
meta="$meta"'content="#[0-9a-fA-F]{3,8}"'
list -rnIiE "$hex" src > "$tmp/colours"
list -v -e '^src/content/' -e '^src/styles/tokens\.css:' "$tmp/colours" > "$tmp/candidates"
sed -E "\\%$meta%s/#[0-9a-fA-F]{3,8}//" "$tmp/candidates" > "$tmp/rest" ||
  fail 'sed could not read the colour lines'
list -iE "$hex" "$tmp/rest" > "$tmp/stray"
if [ -s "$tmp/stray" ]; then
  cut -d: -f1,2 "$tmp/stray" > "$tmp/lines" || fail 'cut could not read the colour lines'
  mask "$tmp/lines" >&3
  fail 'a colour outside tokens.css, at the lines above'
fi

printf '\ngate: pass\n'
