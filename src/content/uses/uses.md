---
updated: "2026-11-11"
summary: "How I work, in rows. Not a recommendation list: these are the things that are actually on the desk and in the shell."
---

Astro 7, prerendered to static pages, with Tailwind 4 reading one file of design tokens. Type is Geist and Geist Mono, served from this site, with Instrument Serif for one word. Cloudflare Pages builds and hosts every push to the GitHub repository. Two cached Pages Functions supply music and activity through the site's own `/api/now-playing` and `/api/activity`; provider requests and credentials stay on the server. The browser loads artwork thumbnails from the Cover Art Archive and keeps each widget's last value when a source fails. Every page but `/now` ships at most 5 KB of gzipped JavaScript, and `/now` at most 7 KB; a local gate checks both.

The design system is Ledger: text first, 1px lines and whitespace instead of cards, and green only for live state. [How it was built](/projects/this-site/) · [source](https://github.com/vedaant-rajoo/vedaant.dev)
