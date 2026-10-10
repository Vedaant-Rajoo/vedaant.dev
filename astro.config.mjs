import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    // The first versions with light-dark(). Below this floor Vite's Lightning CSS minifier
    // rewrites it into a custom-property polyfill; the hex block in tokens.css serves older
    // browsers instead (NFR-B1).
    build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5', 'ios17.5'] },
  },
});
