import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  // Committed latin variable files (fontsource 5.3.0; licence in src/assets/fonts/OFL.txt), one
  // per family, so the build needs no network (NFR-L1). The fallbacks are D24's stacks, repeated in
  // tokens.css; Astro puts a metric-matched face before them and defaults to font-display: swap.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Geist',
      cssVariable: '--ff-geist',
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
  ],
  vite: {
    plugins: [tailwindcss()],
    // The first versions with light-dark(). Below this floor Vite's Lightning CSS minifier
    // rewrites it into a custom-property polyfill; the hex block in tokens.css serves older
    // browsers instead (NFR-B1).
    build: {
      cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5', 'ios17.5'],
      // Astro inlines a processed <script> under 4 KB into each page. Keep scripts as /_astro/
      // files, so a CSP's script-src 'self' covers them and only the is:inline theme restore in
      // Base.astro needs a hash (NFR-X3). Other assets keep Vite's 4 KB default.
      assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
    },
  },
});
