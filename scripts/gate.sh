#!/bin/sh
# The local quality gate: `bun run gate` runs each step in order and stops at the first failure.
# Run it after `bun install --frozen-lockfile`, not while a preview serves dist/ and not beside
# scripts/audit.sh: two `bunx wrangler` launches at once break bunx's cache. Lighthouse, LCP, CLS
# and axe run apart, in scripts/audit.sh.
# shortcut: the offline build uses macOS sandbox-exec; a Linux runner needs `unshare -n` instead.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
step() { printf '\ngate: %s\n' "$*"; }
fail() {
  printf 'gate: FAIL: %s\n' "$*" >&2
  exit 1
}
run() { "$@" < /dev/null > "$tmp/log" 2>&1 || { cat "$tmp/log"; fail "$*"; }; }
hex='#[0-9a-f]{3,8}\b'

step '1/10 bun run check'
run bun run check
grep -q '^Result (' "$tmp/log" || fail 'astro check printed no Result line, so it checked nothing'

step '2/10 bun test'
run bun test

step '3/10 bun run build with every remote host unreachable and no Last.fm or WakaTime key'
command -v sandbox-exec > /dev/null || fail 'the offline build needs sandbox-exec (macOS)'
# astro build opens a socket on this machine, so only localhost stays reachable. The blank keys
# override a local .env, so the gate builds the unset path, as CI does, and never reads a key.
run env LASTFM_API_KEY= WAKATIME_API_KEY= sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip))
  (allow network-outbound (remote ip "localhost:*"))' bun run build
[ "$(grep -c 'lastfm: no value from Last.fm (no LASTFM_API_KEY)' "$tmp/log")" -eq 1 ] &&
  [ "$(grep -c 'lastfm:' "$tmp/log")" -eq 1 ] ||
  fail 'the build did not fall back to the committed Last.fm snapshot exactly once, for no key'
[ "$(grep -c 'wakatime: no value from WakaTime (no WAKATIME_API_KEY)' "$tmp/log")" -eq 1 ] &&
  [ "$(grep -c 'wakatime:' "$tmp/log")" -eq 1 ] ||
  fail 'the build did not fall back to the committed WakaTime snapshot exactly once, for no key'
[ "$(grep -c 'shelf: no on-repeat album from Last.fm (no LASTFM_API_KEY)' "$tmp/log")" -eq 1 ] &&
  [ "$(grep -c 'shelf:' "$tmp/log")" -eq 1 ] ||
  fail 'the build did not fall back to the on-repeat row in shelf.json exactly once, for no key'

step '4/10 no secret in the history or dist/, no environment read outside astro:env or context.env'
command -v gitleaks > /dev/null || fail 'gitleaks is missing: brew install gitleaks'
run gitleaks git --redact --no-banner -c scripts/gitleaks.toml .
run gitleaks dir --redact --no-banner -c scripts/gitleaks.toml dist
# Astro inlines import.meta.env into the build, so src/ may read only its own public names that way;
# a Function reads its environment from context.env alone.
grep -rnoE --include='*.astro' --include='*.[jt]s' --include='*.[cm][jt]s' --include='*.[jt]sx' \
  "import[[:space:]]*\.[[:space:]]*meta[.A-Za-z0-9_\$]*|\b(process|Bun|Deno)\b|globalThis[[:space:]]*\[|[\"']bun[\"']" \
  src functions |
  grep -vE '^src/.*:import\.meta\.env\.(ASSETS_PREFIX|BASE_URL|DEV|MODE|PROD|SITE|SSR)$' &&
  fail 'read secrets through astro:env/server or context.env, not at the lines above'

step '5/10 the Functions: built, no secret in the bundle, routed only at /api/now-playing and /api/coding'
run env WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false bunx wrangler@4.150.0 pages \
  functions build --outdir "$tmp/functions" --output-routes-path "$tmp/routes.json"
run gitleaks dir --redact --no-banner -c scripts/gitleaks.toml "$tmp/functions"
# A request that runs no Function is free, so the generated routes must name the Functions alone,
# and no _routes.json of the site's own may replace them.
routes=$(bun -e 'const r = await Bun.stdin.json(); console.log(JSON.stringify([r.include, r.exclude]))' \
  < "$tmp/routes.json") || fail 'the generated routes are missing or not JSON'
[ "$routes" = '[["/api/now-playing","/api/coding"],[]]' ] ||
  fail "the Functions are routed at $routes (include, exclude), not only at their two paths"
[ ! -e dist/_routes.json ] || fail 'dist/_routes.json would replace the generated routes'

step '6/10 client JavaScript names no third-party API host'
# The browser reads only /api/*, and the artwork is an <img>. fromLive's escaped pattern for
# Cover Art Archive (coverartarchive\.org\/release) is not a match.
grep -l -E 'ws\.audioscrobbler\.com|musicbrainz\.org|coverartarchive\.org/release|wakatime\.com' \
  dist/_astro/*.js && fail 'a script names a third-party API host, in the files above'
# grep exits 2 when it cannot read a file, or when no file matches the glob.
[ "$?" -eq 1 ] || fail 'grep could not read dist/_astro/*.js'

step '7/10 bun scripts/pages.ts: widgets, JS at most 5,120 B gzip, sizes, titles'
bun scripts/pages.ts || fail 'bun scripts/pages.ts'

step '8/10 bun scripts/csp-hash.ts: the CSP allows the theme restore as built'
bun scripts/csp-hash.ts || fail 'bun scripts/csp-hash.ts'

step '9/10 bun scripts/contrast.ts: contrast in both themes'
run bun scripts/contrast.ts

step '10/10 colours only in tokens.css'
# Content quotes colours on purpose, and the theme-color metas in Base.astro repeat the --c-bg hex.
grep -rnIiE "$hex" src | grep -v -e '^src/content/' -e '^src/styles/tokens\.css:' |
  sed -E 's%^(src/layouts/Base\.astro:[0-9]+:[[:space:]]*<meta name="theme-color" content=")#[0-9a-fA-F]{3,8}"%\1"%' |
  grep -iE "$hex" && fail 'a colour outside tokens.css, at the lines above'

printf '\ngate: pass\n'
