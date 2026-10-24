#!/bin/sh
# Launch audits of every built page: Lighthouse mobile with its default simulated throttling (the
# agreed reference) at least 95 in all four categories, LCP at most 1.8 s and CLS 0, then axe with
# no violations in light and dark. Run after `bun run build`; needs Chrome, and for axe a
# chromedriver matching it in $CHROMEDRIVER. The Pages runtime serves dist/ so _headers apply.
set -eu
cd "$(dirname "$0")/.."
port=${PORT:-4331}
out=$(mktemp -d)
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false bunx wrangler@4.150.0 pages dev dist \
  --ip 127.0.0.1 --port "$port" --inspector-port $((port + 5000)) > "$out/server.log" 2>&1 &
server=$!
trap 'kill $server; rm -rf "$out"' EXIT
tries=0
until curl -fso /dev/null "http://127.0.0.1:$port/"; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || { cat "$out/server.log"; exit 1; }
  sleep 1
done
urls=$(cd dist && find . -name '*.html' | sort | sed -e 's#^\.##; s#index\.html$##; s#\.html$##' \
  -e "s#^#http://127.0.0.1:$port#")

for url in $urls; do
  # axe still reads /404; its noindex is deliberate and would fail Lighthouse SEO.
  [ "${url%/404}" = "$url" ] || continue
  npx -y lighthouse@13.5.0 "$url" --form-factor=mobile --output=json --quiet \
    --only-categories=performance,accessibility,best-practices,seo \
    --chrome-flags='--headless=new --no-sandbox' --output-path="$out/$(echo "$url" | tr -c 'a-z0-9\n' _).json"
done
bun -e '
let failed = 0;
for (const file of process.argv.slice(1)) {
  const { finalDisplayedUrl: url, categories, audits } = await Bun.file(file).json();
  const scores = Object.values(categories).map((c) => [c.id, Math.round(c.score * 100)]);
  const lcp = Math.round(audits["largest-contentful-paint"].numericValue);
  const cls = audits["cumulative-layout-shift"].numericValue;
  const ok = scores.every(([, s]) => s >= 95) && lcp <= 1800 && cls === 0;
  failed += ok ? 0 : 1;
  console.log(`${ok ? "pass" : "FAIL"} ${new URL(url).pathname}: ${scores.flat().join(" ")}, LCP ${lcp} ms, CLS ${cls}`);
}
process.exitCode = failed ? 1 : 0;
' "$out"/*.json || failed=1

for scheme in 1 0; do # light, dark
  npx -y @axe-core/cli@4.14.0 $urls --exit ${CHROMEDRIVER:+--chromedriver-path "$CHROMEDRIVER"} \
    --chrome-options="headless=new,no-sandbox,blink-settings=preferredColorScheme=$scheme" ||
    failed=1
done
exit "${failed:-0}"
