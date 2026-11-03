#!/bin/sh
# Launch audits of every built page: three sequential Lighthouse mobile runs with its default
# simulated throttling. Median performance at least 95; every run's other categories at least 95,
# LCP at most 1.8 s and CLS 0, then axe with no violations in light and dark. Needs Chrome and a
# chromedriver matching it in $CHROMEDRIVER. The Pages runtime serves dist/ so _headers apply.
set -eu
cd "$(dirname "$0")/.."
port=${PORT:-4331}
out=$(mktemp -d)
[ -z "${GITHUB_OUTPUT:-}" ] || printf 'reports=%s\n' "$out" >> "$GITHUB_OUTPUT"
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false bunx wrangler@4.150.0 pages dev dist \
  --compatibility-date 2024-10-31 --ip 127.0.0.1 --port "$port" --inspector-port $((port + 5000)) \
  > "$out/server.log" 2>&1 &
server=$!
trap 'kill "$server"; [ -n "${GITHUB_OUTPUT:-}" ] || rm -rf "$out"' EXIT
tries=0
until curl -fso /dev/null "http://127.0.0.1:$port/"; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || { cat "$out/server.log"; exit 1; }
  sleep 1
done
urls=$(cd dist && find . -name '*.html' | sort | sed -e 's#^\.##; s#index\.html$##; s#\.html$##' \
  -e "s#^#http://127.0.0.1:$port#")

# The job's first run meets a cold Chrome and server (its / sample alone failed, TBT up to 1.7 s); discard it.
npx -y lighthouse@13.5.0 "http://127.0.0.1:$port/" --form-factor=mobile --output=json --quiet \
  --only-categories=performance --chrome-flags='--headless=new --no-sandbox' --output-path="$out/warmup.json"
for url in $urls; do
  # axe still reads /404; its noindex is deliberate and would fail Lighthouse SEO.
  [ "${url%/404}" = "$url" ] || continue
  for run in 1 2 3; do
    npx -y lighthouse@13.5.0 "$url" --form-factor=mobile --output=json --save-assets --quiet \
      --only-categories=performance,accessibility,best-practices,seo \
      --chrome-flags='--headless=new --no-sandbox' --output-path="$out/$(echo "$url" | tr -c 'a-z0-9\n' _).$run.report.json"
  done
done
bun -e '
let failed = 0;
const performance = new Map();
for (const file of process.argv.slice(1)) {
  const { finalDisplayedUrl: url, categories, audits } = await Bun.file(file).json();
  const page = new URL(url).pathname;
  const samples = performance.get(page) ?? [];
  samples.push(Math.round(categories.performance.score * 100));
  performance.set(page, samples);
  const scores = Object.values(categories).map((c) => [c.id, Math.round(c.score * 100)]);
  const lcp = Math.round(audits["largest-contentful-paint"].numericValue);
  const fcp = Math.round(audits["first-contentful-paint"].numericValue);
  const speed = Math.round(audits["speed-index"].numericValue);
  const tbt = Math.round(audits["total-blocking-time"].numericValue);
  const cls = audits["cumulative-layout-shift"].numericValue;
  const ok = scores.every(([id, s]) => id === "performance" || s >= 95) && lcp <= 1800 && cls === 0;
  failed += ok ? 0 : 1;
  console.log(`${ok ? "sample" : "FAIL"} ${page}: ${scores.flat().join(" ")}, FCP ${fcp} ms, LCP ${lcp} ms, Speed Index ${speed} ms, TBT ${tbt} ms, CLS ${cls}`);
}
for (const [page, scores] of performance) {
  const median = scores.sort((a, b) => a - b)[1];
  const ok = scores.length === 3 && median >= 95;
  failed += ok ? 0 : 1;
  console.log(`${ok ? "pass" : "FAIL"} ${page}: median performance ${median}, ${scores.length} runs`);
}
process.exitCode = failed ? 1 : 0;
' "$out"/*.report.json || failed=1

for scheme in 1 0; do # light, dark
  npx -y @axe-core/cli@4.14.0 $urls --exit ${CHROMEDRIVER:+--chromedriver-path "$CHROMEDRIVER"} \
    --chrome-options="headless=new,no-sandbox,blink-settings=preferredColorScheme=$scheme" ||
    failed=1
done
exit "${failed:-0}"
