import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField, fontProviders } from 'astro/config';

export default defineConfig({
  // The production origin: canonical and Open Graph URLs name it on every build, previews
  // included, and so does the sitemap.
  site: 'https://vedaantrajoo.com',
  // Pages serves each page at its directory URL and answers /projects with a 308 to /projects/. A
  // build's Astro.url already ends in a slash (build.format 'directory'), and 'ignore' keeps dev
  // serving the slashless links the nav and rows use, which 'always' answers with a 404.
  trailingSlash: 'ignore',
  // F1: every page carries the stylesheet in its own <style>, so first paint waits
  // for no second request. It costs about 5 KB of gzip HTML per page and the shared CSS file.
  build: { inlineStylesheets: 'always' },
  // sitemap-index.xml lists every page the build makes, in that slash form. A draft has no
  // page outside astro dev (pieces(), hasCaseStudy), so it cannot appear; the integration leaves out
  // the 404 and endpoints such as /feed.xml. The résumé is a file, not a page, so it is named.
  integrations: [sitemap({ customPages: ['https://vedaantrajoo.com/resume.pdf'] })],
  // Committed latin variable files (fontsource 5.3.0; licence in src/assets/fonts/OFL.txt), one
  // per family, so the build needs no network. The sans subset also includes ← → ↗ from
  // google/fonts ofl/geist/Geist[wght].ttf, version 1.800, matching its existing glyphs.
  // The fallback stacks are repeated in tokens.css; Astro puts a metric-matched face
  // before them. The sans is optional: used if it is ready within its short block
  // period and never swapped in later, so it cannot re-wrap text; the mono keeps swap.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Geist',
      cssVariable: '--ff-geist',
      display: 'optional',
      fallbacks: ['system-ui', '-apple-system', 'sans-serif'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/geist-latin-wght-normal.woff2'],
            weight: '100 900',
            style: 'normal',
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Geist Mono',
      cssVariable: '--ff-geist-mono',
      display: 'optional',
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/geist-mono-latin-wght-normal.woff2'],
            weight: '100 900',
            style: 'normal',
          },
        ],
      },
    },
    {
      // The hero's one serif word (licence in src/assets/fonts/OFL-instrument-serif.txt).
      // optional: used only if it is ready at once and never swapped in, so a late font leaves the
      // word in the sans and nothing moves. No fallbacks: tokens.css puts the sans after it.
      // The file holds only the glyphs of hero.accent, "systems" (3 KB, not the latin file's
      // 22 KB, so less of the first view's bandwidth); site.ts rejects an accent it cannot draw.
      // Made from fontsource 5.3.0's latin 400 italic with fonttools:
      // pyftsubset <latin file> --text=systems --flavor=woff2 --name-IDs='*'
      provider: fontProviders.local(),
      name: 'Instrument Serif',
      cssVariable: '--ff-instrument-serif',
      display: 'optional',
      fallbacks: [],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/instrument-serif-systems-400-italic.woff2'],
            weight: '400',
            style: 'italic',
          },
        ],
      },
    },
  ],
  // Code fences: Shiki's css-variables theme writes each token's colour as a CSS variable,
  // and global.css maps those to the tokens, so code follows the theme, hex fallbacks included,
  // with no colour hard-coded. wrap: null adds no inline overflow; global.css sets it.
  markdown: { shikiConfig: { theme: 'css-variables', wrap: null } },
  // cloudflared Quick Tunnels give the dev server a new random subdomain of trycloudflare.com on
  // every run, so the leading dot allows the whole domain. Cloudflare owns its DNS, so this keeps
  // Vite's host check closed to DNS rebinding.
  server: { allowedHosts: ['.trycloudflare.com'] },
  // The Last.fm and WakaTime keys come only from the host's environment: encrypted Pages secrets
  // in a Cloudflare build, a gitignored .env locally. Astro reads a secret when the build runs and
  // never inlines it; unset, lastfm.ts and wakatime.ts use the committed snapshots.
  env: {
    schema: {
      LASTFM_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      WAKATIME_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // The first versions with light-dark(). Below this floor Vite's Lightning CSS minifier
    // rewrites it into a custom-property polyfill; the hex block in tokens.css serves older
    // browsers instead.
    build: {
      cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5', 'ios17.5'],
      // Astro inlines a processed <script> under 4 KB into each page. Keep scripts as /_astro/
      // files, so a CSP's script-src 'self' covers them and only the is:inline theme restore in
      // Base.astro needs a hash. Other assets keep Vite's 4 KB default.
      assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
    },
  },
});
