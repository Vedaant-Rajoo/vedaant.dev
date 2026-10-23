---
title: this site
summary: a text-first portfolio with a live layer
year: 2026
stack: [Astro, TypeScript, Tailwind CSS]
status: active
featured: true
draft: true
repo: https://github.com/vedaant-rajoo/vedaant.dev
---

## The problem

I needed a site that says what I do and where I have worked within ten seconds on a phone, keeps my résumé and email within two clicks of every page, and shows what I am building now without becoming a chore. I also wanted it to show how I like to build: measured, text first, and complete with JavaScript turned off.

The design is called Ledger. Separation comes from 1px lines and whitespace instead of cards or shadows. There is no icon set, only text glyphs, and green marks live state and nothing else. The bars were written down before the first commit. LCP at or under 1.2 s in the lab, zero layout shift including live-state changes, at most 5 KB of gzipped JavaScript per page, two font requests on first paint, and Lighthouse at 95 or more in all four categories. Zero axe violations, contrast measured in both themes, every animation gone under reduced motion, no horizontal scroll at 320 px, and 44 px targets. No secrets in the build output, a CSP without unsafe-inline for scripts, zero cookies, and a new project live as one file in under five minutes.

## My role

Everything: the choices, the content, the code and the checks. The site is built one step at a time from a written roadmap. Each step is briefed, implemented in its own worktree, reviewed independently, and then read by me before it is committed. I work with coding agents for the implementation. The roadmap, the decisions and the step records live in an untracked folder beside the repository, so the reasons are written down even where the code does not show them.

## Decisions

<dl>
<dt>chose</dt>
<dd>a static site whose pages read Last.fm from the browser, with the API key in the page</dd>
<dt>over</dt>
<dd>five other ways to get the value: scheduled rebuilds, a cron Worker writing JSON to R2 behind the site's own origin, Lanyard's WebSocket, Lanyard's KV store as a relay, and one Pages Function</dd>
<dt>because</dt>
<dd><code>user.getRecentTracks</code> needs no authentication, answers with an open CORS header, and Last.fm's terms have no clause that treats the key as confidential, so the key is a public, read-only identifier. That leaves no runtime, no adapter, no secret and nothing to cache, and a folder of files scales on its own. Lanyard lost on a fact: it cannot see Apple Music on an iPhone. The costs are written down too. The key and my user name are public, each visitor's browser contacts Last.fm, and a suspended key shows the build-time value until I replace it.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>Cloudflare Pages</dd>
<dt>over</dt>
<dd>Vercel, which the design pages name</dd>
<dt>because</dt>
<dd>my DNS was already on Cloudflare, a static build needs no adapter, and Pages serves static requests free and without a cap, so the deploy is one GitHub Actions job that checks, builds and uploads <code>dist/</code>.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>plain Markdown</dd>
<dt>over</dt>
<dd>MDX, which the spec asked for</dd>
<dt>because</dt>
<dd>code fences give highlighted code, GFM gives footnotes and an image is a diagram, so Markdown covers both case studies and the one post, and skipping MDX keeps one of the twelve allowed dependencies free. The day a study needs a component, MDX comes in.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>the clock as the theme button, cycling light, dark and system</dd>
<dt>over</dt>
<dd>a theme set by the time of day</dd>
<dt>because</dt>
<dd>an automatic switch surprises people, and the OS already offers one. The design's comparison also dropped <code>prefers-color-scheme</code> alone, which gives the visitor no override, and a CSS-only checkbox, which cannot persist across pages without JavaScript. "System" means no attribute at all, and an inline script in <code>&lt;head&gt;</code> restores a stored choice before paint, so there is no flash.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>a live green of oklch(52% 0.14 150), which converts exactly to <code>#0a7e3a</code>, and a darker hex for secondary text</dd>
<dt>over</dt>
<dd>the design doc's light green and its light secondary-text hex</dd>
<dt>because</dt>
<dd>the doc's green measured 4.32:1 as oklch and 4.09:1 as its hex fallback against a bar of 4.6:1, and the secondary hex measured 6.83:1 against 8:1. The replacement green measures 4.96:1 and 4.95:1. The rules now say to measure again after any token edit.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>one serif word in the hero, loaded with <code>font-display: optional</code></dd>
<dt>over</dt>
<dd>no serif at all, which the first roadmap settled on</dd>
<dt>because</dt>
<dd>a third font request for one word breaks the two-request budget on first paint. With <code>optional</code> the browser uses the serif only if it is ready at once and never swaps it in later, so a slow font leaves the word in the sans at the same size, and nothing moves.</dd>
</dl>

## Architecture

Astro 7, prerendered, with Tailwind 4 reading one token file, `tokens.css`, where every colour is a `light-dark()` pair in oklch with a hex block for older browsers. Content is data: `work.json` goes through a loader that fails the build when the file is empty, projects and writing are Markdown collections with zod schemas that reject an unknown field or a summary over 90 characters, and a `prebuild` step refuses to build without the dated résumé PDF. Fonts load through the Astro Fonts API from committed latin subsets, so the build needs no network for them either.

Pages brought two small things with it. A top-level `404.html` has to exist, because Pages otherwise answers unknown paths with the home page, and the `/resume` redirect lives in `public/_redirects`. The theme switch reveals the new theme in a circle from the clock with a view transition, and swaps at once when the two themes paint the same, when the browser lacks the API, or under reduced motion.

```text
build (GitHub Actions, on push)                      visitor
  src/content, src/data ---+                           prerendered page
  Last.fm, 5 s budget -----+-- astro build --> dist/ --> Cloudflare Pages --> head script restores the theme
  snapshots/lastfm.json ---+   (fallback)                                    clock ticks once a minute
                                                                             presence hub polls Last.fm (next step)
```

The live layer is thin. At build, `lastfm.ts` fetches the latest track once with a five-second budget and falls back to a committed snapshot, which a test proves is a valid idle value, so a page always has a value, with JavaScript off too. The row that shows it and the `<presence-hub>` element that polls Last.fm from the browser are the next steps, and the browser fetches nothing else.

## A piece of it

This is the build-time fetch. One `AbortSignal.timeout` covers the request and its body. Every failure path (a bad status, a body the mapping rejects, a timeout, a network error) ends in the committed snapshot with a one-line warning that names the reason and never quotes the body. The module's top-level `await` runs once per build, so every page shares one request.

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

The repository started on 10 October 2026. Six days and 36 commits later it had the home page, `/projects`, the 404 page, the writing collection with its newest rows on the home page, and this case-study page, and every push deployed a preview at ledger-mvp.vedaantrajoo.com. Each page ships 1,702 bytes of gzipped JavaScript (1,867 on the 404 page) against the 5,120-byte gate, the stylesheet is about 5 KB gzipped, and the three font files total 73,944 bytes of the 90 KB budget, with only the sans and the mono requested on first paint. The build passes with Last.fm unreachable. Eleven of twenty components and seven of twelve dependencies are in use. Lighthouse, axe and the field numbers come at a later step, so there are none to report yet. The site will live at vedaantrajoo.com.

## Links

- Source: https://github.com/vedaant-rajoo/vedaant.dev (private until launch)
- Last.fm API: https://www.last.fm/api/show/user.getRecentTracks
