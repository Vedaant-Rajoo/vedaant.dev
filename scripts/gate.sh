#!/bin/sh
# The local quality gate: `bun run gate` runs each step in order and stops at the first failure.
# Run it after `bun install --frozen-lockfile`, not while a preview serves dist/. Lighthouse, LCP,
# CLS and axe run apart, in scripts/audit.sh.
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
# Runs a tool quietly and shows its output only when it fails.
run() { "$@" < /dev/null > "$tmp/log" 2>&1 || { cat "$tmp/log"; fail "$*"; }; }
hex='#[0-9a-f]{3,8}\b'

step '1/8 bun run check'
run bun run check
grep -q '^Result (' "$tmp/log" || fail 'astro check printed no Result line, so it checked nothing'

step '2/8 bun test'
run bun test

step '3/8 bun run build with every remote host unreachable'
command -v sandbox-exec > /dev/null || fail 'the offline build needs sandbox-exec (macOS)'
# astro build opens a socket on this machine, so only localhost stays reachable.
run sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip))
  (allow network-outbound (remote ip "localhost:*"))' bun run build
[ "$(grep -c 'lastfm:' "$tmp/log")" -eq 1 ] ||
  fail 'the build did not fall back to the committed Last.fm snapshot exactly once'

step '4/8 no secret in the history or dist/, no environment read outside astro:env'
command -v gitleaks > /dev/null || fail 'gitleaks is missing: brew install gitleaks'
run gitleaks git --redact --no-banner -c scripts/gitleaks.toml .
run gitleaks dir --redact --no-banner -c scripts/gitleaks.toml dist
# Astro inlines import.meta.env into the build, so src/ may read only its own public names that way.
grep -rnoE --include='*.astro' --include='*.[jt]s' --include='*.[cm][jt]s' --include='*.[jt]sx' \
  "import[[:space:]]*\.[[:space:]]*meta[.A-Za-z0-9_\$]*|\b(process|Bun|Deno)\b|globalThis[[:space:]]*\[|[\"']bun[\"']" src |
  grep -vE ':import\.meta\.env\.(ASSETS_PREFIX|BASE_URL|DEV|MODE|PROD|SITE|SSR)$' &&
  fail 'read secrets through astro:env/server, not at the lines above'

step '5/8 bun scripts/pages.ts: widgets, JS at most 5,120 B gzip, sizes, titles'
bun scripts/pages.ts || fail 'bun scripts/pages.ts'

step '6/8 bun scripts/csp-hash.ts: the CSP allows the theme restore as built'
bun scripts/csp-hash.ts || fail 'bun scripts/csp-hash.ts'

step '7/8 bun scripts/contrast.ts: contrast in both themes'
run bun scripts/contrast.ts

step '8/8 colours only in tokens.css'
# Content quotes colours on purpose, and the theme-color metas in Base.astro repeat the --c-bg hex.
grep -rnIiE "$hex" src | grep -v -e '^src/content/' -e '^src/styles/tokens\.css:' |
  sed -E 's%^(src/layouts/Base\.astro:[0-9]+:[[:space:]]*<meta name="theme-color" content=")#[0-9a-fA-F]{3,8}"%\1"%' |
  grep -iE "$hex" && fail 'a colour outside tokens.css, at the lines above'

printf '\ngate: pass\n'
