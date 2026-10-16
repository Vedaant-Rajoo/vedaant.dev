---
title: this site
summary: A text-first portfolio with a live layer
year: 2026
stack: [Astro, TypeScript, Tailwind CSS]
status: active
featured: true
draft: true
repo: https://github.com/vedaant-rajoo/vedaant.dev
---

## The problem

I needed a site that says what I do and where I have worked within ten seconds on a phone, keeps my résumé and email within two clicks of every page, and shows what I am building now without becoming a chore. I also wanted it to show how I like to build: measured, text first, and complete with JavaScript turned off.

The design is called Ledger. Separation comes from 1px lines and whitespace rather than cards or shadows, there is no icon set, only text glyphs, and green marks live state and nothing else. The bars were written down before the first commit. LCP at or under 1.2 s in the lab, zero layout shift including live-state changes, at most 5 KB of gzipped JavaScript per page, two font requests on first paint, and Lighthouse at 95 or more in all four categories. Zero axe violations, contrast measured in both themes, every animation gone under reduced motion, no horizontal scroll at 320 px, and 44 px targets. No secrets in the build output, a CSP without unsafe-inline for scripts, zero cookies, and a new project live as one file in under five minutes.

## My role

Everything: the choices, the content, the code and the checks. The site is built one step at a time from a written roadmap. Each step is briefed, implemented in its own worktree, reviewed independently, and then read by me before it is committed. I work with coding agents for the implementation. The roadmap, the decisions and the step records live in an untracked folder beside the repository, so the reasons are written down even where the code does not show them.

## Decisions

The site is static, and the browser reads Last.fm directly. The home page gets a now-playing row fed by Last.fm. The design pages assumed a same-origin endpoint for it, and when that step came up I weighed six ways to get the value: scheduled rebuilds; a cron Worker writing JSON to R2 and served from the same origin; the browser calling Last.fm itself; Lanyard's WebSocket; Lanyard's KV store as a relay; and a single Pages Function. I chose the browser call. `user.getRecentTracks` needs no authentication, answers with an open CORS header, and Last.fm's terms have no clause that treats the API key as confidential, so the key is a public, read-only identifier that can ship in the page. That means no runtime, no adapter, no secret and nothing to cache: the site stays a folder of files, and static scales. Lanyard lost on a fact: it has no way to see Apple Music on an iPhone. The costs are accepted and written down. The key and my Last.fm user name are public, each visitor's browser contacts Last.fm, and if the key is ever suspended the row shows its build-time value until I replace it.

The host is Cloudflare Pages, where the design pages say Vercel. My DNS was already on Cloudflare, the static build needs no adapter, and Pages serves static requests free and without a cap, so the deploy is one GitHub Actions job that checks, builds and uploads `dist/`. Two things followed: a top-level `404.html` has to exist, because Pages otherwise answers unknown paths with the home page, and the `/resume` redirect lives in `public/_redirects`.

The content is Markdown, without MDX. The spec wanted MDX for projects and writing. Code fences give highlighted code, GFM gives footnotes, and an image is a diagram, so plain Markdown covers both case studies and the one post, and skipping MDX keeps one of the twelve allowed dependencies free. The day a case study needs a component, MDX comes in.

The clock is the theme button. The time in the nav is a button that cycles light, dark, system, and never picks a theme by the time of day. An inline script in `<head>` restores the stored choice before paint, so there is no flash and no layout shift; "system" means no attribute at all, and the CSS follows the OS. The switch reveals the new theme in a circle from the clock with a view transition, and swaps at once when the two themes paint the same, when the browser lacks the API, or under reduced motion.

Contrast is measured. The design doc's light green for live state measured 4.32:1 as oklch and 4.09:1 as its hex fallback, under the 4.6:1 the gate asks for, and its light secondary-text hex measured 6.83:1 against a bar of 8:1. Both tokens changed: the live green is now oklch(52% 0.14 150), which converts exactly to `#0a7e3a` and measures 4.96:1 and 4.95:1, and the secondary text got a darker hex. The rules now say to measure again after any token edit.

The hero sets one word in Instrument Serif. The first roadmap skipped the font, because a third request for one word breaks the two-request budget on first paint. It came back under one condition: the serif loads with `font-display: optional`, so the browser uses it only if it is ready at once and never swaps it in later. A slow font leaves the word in the sans at the same size, and nothing moves.

## Architecture

Astro 7, prerendered, with Tailwind 4 reading one token file, `tokens.css`, where every colour is a `light-dark()` pair in oklch with a hex block for older browsers. There is one layout, ten components and seven dependencies. Content is data: `work.json` goes through a loader that fails the build when the file is empty, projects and writing are Markdown collections with zod schemas that reject an unknown field or a summary over 90 characters, and a `prebuild` step refuses to build without the dated résumé PDF. Fonts load through the Astro Fonts API from committed latin subsets, so the build needs no network for them either.

```text
build (GitHub Actions, on push)                      visitor
  src/content, src/data ---+                           prerendered page
  Last.fm, 5 s budget -----+-- astro build --> dist/ --> Cloudflare Pages --> head script restores the theme
  snapshots/lastfm.json ---+   (fallback)                                    clock ticks once a minute
                                                                             presence hub polls Last.fm (next step)
```

The live layer is thin. At build, `lastfm.ts` fetches the latest track once with a five-second budget and falls back to a committed snapshot, which a test proves is a valid idle value, so a page always has a value, with JavaScript off too. The row that shows it and the `<presence-hub>` element that polls Last.fm from the browser are the next steps, and the browser fetches nothing else.

## A piece of it

This is the build-time fetch. Notice that one `AbortSignal.timeout` covers the request and its body; that every failure path (a bad status, a body the mapping rejects, a timeout, a network error) ends in the committed snapshot with a one-line warning that names the reason and never quotes the body; and that the module's top-level `await` runs once per build, so every page shares one request.

```ts
async function load(): Promise<NowPlaying> {
  let reason: string;
  try {
    // One 5 s budget for the whole request, its body included.
    const response = await fetch(recentTracks, { signal: AbortSignal.timeout(5_000) });
    const value = response.ok ? toNowPlaying(await response.json()) : null;
    if (value) {
      return value;
    }
    reason = response.ok ? 'unexpected body' : `HTTP ${response.status}`;
  } catch (error) {
    // The name only: a JSON error's message quotes the body, line breaks included.
    reason = error instanceof Error ? error.name : 'unknown error';
  }
  console.warn(`lastfm: no value from Last.fm (${reason}); using the committed snapshot`);
  return fallback;
}
```

## Trade-offs

Going static with a public key means the parts of the spec that assumed an endpoint no longer apply to it: no filtered response shape, no edge cache in front of Last.fm, and no server to keep the user name behind. The value a visitor sees is as fresh as the last poll, and a suspended key degrades to the build-time value, never to an error. Plain Markdown means no components inside prose until MDX is added. The serif word may never appear for a visitor on a slow connection, and that is what `optional` is for. Reduced motion removes every animation, the theme reveal and the hero's highlighter swipe included. The repository is private while the site is built, so the source links are dead until launch. And the no-framework rule means every live piece is CSS first, then a plain script or a custom element, which is slower to write than dropping in a component, and so far has kept each page well inside its budget.

## Outcome

The repository started on 10 October 2026 and is 35 commits in: the home page, `/projects` and the 404 page are built, writing landed on 16 October, and every push deploys a preview at ledger-mvp.vedaantrajoo.com. Each page ships 1,702 bytes of gzipped JavaScript (1,867 on the 404 page) against the 5,120-byte gate, the stylesheet is about 4.5 KB gzipped, the three font files total 73,944 bytes of the 90 KB budget with only the sans and the mono requested on first paint, and the build passes with Last.fm unreachable. Ten of twenty components and seven of twelve dependencies are in use. Lighthouse, axe and the field numbers come at a later step, so there are none to report yet. The site will live at vedaantrajoo.com.

## Links

- Source: https://github.com/vedaant-rajoo/vedaant.dev (private until launch)
- Last.fm API: https://www.last.fm/api/show/user.getRecentTracks
