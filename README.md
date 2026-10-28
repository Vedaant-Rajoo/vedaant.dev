# vedaant.dev

Vedaant Rajoo's Ledger site, built with Astro, plain Markdown and Tailwind CSS v4
over local design tokens. Pages are static and music updates in the browser. The
site lives at https://vedaantrajoo.com; `vedaant.dev` is only the project's name.

## Run locally

Use Bun 1.4.2 and Node 24.14.1, the versions [the gate](.github/workflows/gate.yml)
and the Cloudflare build pin. Nothing in the repository selects them for you.

```sh
bun --version
node --version
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 4325
```

Open http://127.0.0.1:4325, or pick another free port. To serve a production
build, stop the dev server first:

```sh
bun run check
bun run build
bun run preview --host 127.0.0.1 --port 4325
```

`check` runs Biome and Astro diagnostics. Look for Astro's `Result (` summary,
since an exit code alone does not prove Astro checked any files. If Astro offers
to install its checker, answer No and rerun the frozen install. `build` fails
unless [public/resume.pdf](public/resume.pdf) exists, then writes `dist/`.
`preview` serves that build and does not watch source files.

If a server command returns while the server keeps running, Astro chose
background mode (`--background` asks for it). Stop it with `bun run dev stop` or
`bun run preview stop` from the same checkout.

Running or building needs no `.env` file or Cloudflare credentials. Only the
first install needs the network; builds fall back to the committed fonts and
music snapshot when external APIs are down.

Other scripts in [package.json](package.json):

- `bun test`: data tests.
- `bun run gate`: the full local gate, below.
- `bun run fix`: applies Biome fixes, so it changes files.

## Edit content

Content lives in these files, never in components.
[src/content.config.ts](src/content.config.ts) validates collection fields,
[src/data/site.ts](src/data/site.ts) validates site settings,
[src/data/uses.ts](src/data/uses.ts) validates the uses rows and
[src/data/shelf.ts](src/data/shelf.ts) validates the shelf.

| Content | File |
| --- | --- |
| Project rows and case studies | `src/content/projects/*.md` |
| Posts and notes | `src/content/writing/*.md` |
| Now page, city and building row | [src/content/now/now.md](src/content/now/now.md) |
| Work history | [src/data/work.json](src/data/work.json) |
| Uses rows | [src/data/uses.json](src/data/uses.json) |
| Uses date, intro and colophon | [src/content/uses/uses.md](src/content/uses/uses.md) |
| Shelf lists, reading, last-watched and on-repeat rows, date and intro | [src/data/shelf.json](src/data/shelf.json) |
| Name, hero, time zone, email, links and résumé date | [src/data/site.json](src/data/site.json) |
| Résumé PDF | [public/resume.pdf](public/resume.pdf) |
| Offline music value | [src/data/snapshots/lastfm.json](src/data/snapshots/lastfm.json) |

### Add a project

A project is one file. This fictional example, for a disposable checkout, goes
in `src/content/projects/readme-example.md`:

```yaml
---
title: Example project
summary: a fictional project for checking these instructions
year: 2026
stack: []
status: done
featured: false
---
```

Run `bun run check` and `bun run build`, then look at `/projects` in the preview.
The example adds a row with no link, no case-study page and no home-page slot.
No component, page or index needs editing.

All six fields are required. `title` is nonempty, `summary` is 1–90 characters,
`year` is an integer from 1000 to 9999, and `stack` holds up to four nonempty
labels of at most 24 characters. `status` is `active`, `done` or `archived`;
`featured` is a boolean.

Optional fields:

- `repo`: an `https://` repository URL. A row without a case study links here.
- `prs`: an `https://` link to your contributions, which moves the row into the
  open source group. Add a quoted `start` month (`YYYY-MM`) if you like.
- `confidential: true`: drops repository and PR links and shows a
  confidentiality note. Metadata and any case study stay visible.
- `draft`, `published`, `updated`: case-study controls, below.

`/projects` lists every project, drafts and archived rows included. Home shows
the four newest featured, non-archived rows, ordered by year and then file id,
so `featured: true` does not guarantee a home slot.

### Turn a project into a case study

Write a body of at least 500 words, with `draft: true` while you work.
[hasCaseStudy()](src/data/projects.ts) counts whitespace-separated tokens,
Markdown and code syntax included. Start headings at `##`; the template owns the
only h1.

`bun run dev` shows draft studies. A production build leaves out their study
pages but still publishes their project rows, so draft is not a privacy control.
A body under 500 words never gets a study page.

To publish, remove `draft: true` (or set it to `false`) and add the publication
day as a quoted string, such as `published: "2026-10-23"`. A non-draft study
without `published` fails the build. An optional `updated` must be later than
`published`. Rebuild and check `/projects/<file-name>/`; the row now opens the
study instead of the repository.

File names are page ids and URLs. Renaming a published one also needs a redirect
in [public/_redirects](public/_redirects). `clai` and `this-site` are published
and featured.

### Writing, feed and sitemap

A post or note is one Markdown file in `src/content/writing/`. It requires
`title`, `summary`, a quoted `published: "YYYY-MM-DD"` and `kind: post` or
`kind: note`. `draft` defaults to `false`. An optional `updated` may fall on the
publication day or later. An optional `project` names an existing project id,
without `.md`.

Start headings at `##` and link within the site with root-relative paths such as
`/projects/clai/`. [pieces()](src/data/writing.ts) shows drafts only in dev;
production leaves them out of lists, post pages and the full-content RSS feed at
`/feed.xml`. Don't share a dev server that shows private drafts. Home shows the
two newest pieces.

[src/data/feed.ts](src/data/feed.ts) makes body links and images absolute in
the feed. It reads `href` and `src` in double quotes, as Markdown writes them;
raw HTML with single quotes or other attributes such as `srcset` stays relative,
so use Markdown or double quotes. A character XML cannot carry fails the build
and the error names the post. [astro.config.mjs](astro.config.mjs) generates `/sitemap-index.xml`
and `/sitemap-0.xml` from built pages plus `/resume.pdf`, without draft pages,
the 404 or dev-only `/_states`. Every page head and the footer link the feed.
If the origin ever changes, update `site`, the sitemap's `customPages` and
[public/robots.txt](public/robots.txt) together.

### Now, work, uses, shelf and résumé

- `now.md` is the only file read from its directory. Its frontmatter requires a
  quoted `updated`, `from` (the city) and `building`. The body is unique,
  lowercase `## label` sections of paragraphs, at most 400 words in all. Links,
  emphasis, strikethrough, code spans and line breaks work; lists, images and
  code blocks do not, and `bun test` checks that shape. Bump `updated` when you
  edit. Launch needs a date within the last 14 days, and the page shows stale
  after 60 days.
- `work.json` is a nonempty object keyed by stable role ids. Each role needs
  `employer`, `role`, a quoted `start: "YYYY-MM"`, `end` (a quoted month, or
  `null` while ongoing) and a `summary` of 1–140 characters. `url` is optional
  and uses `https://`. An end cannot precede its start. Home shows every ongoing
  role and the two newest ended ones, and folds two or more older roles behind
  "earlier". The schema accepts a `collapse` field, but it controls nothing.
- When work changes, replace `public/resume.pdf` and set `resume.updated` in
  `site.json` to the PDF's date. `/resume` redirects to `/resume.pdf`. The build
  checks that the file exists, not that it is current.
- `uses.json` is a nonempty array of `/uses` rows. Each needs `group`
  (`hardware`, `editor and shell` or `desktop`, shown in that order), `name`
  and `note`; `url` (an `https://` link on the name) and `retired` (a year,
  which strikes the row through) are optional. Rows keep their file order.
  Retire a row instead of deleting it. A new group needs a line in
  [src/data/uses.ts](src/data/uses.ts). Keep hex colour codes out of this file:
  the gate allows them only under `src/content/`.
- `uses.md` is the only file read from its directory. Its frontmatter requires
  a quoted `updated` day and `summary`, the intro under the heading and the
  page's description. Its body is the colophon and must not be empty. Bump
  `updated` when you edit either file. Tailwind scans both files, so after an
  edit compare each page's `<style>` with the previous build, as for the music
  snapshot.
- `shelf.json` is `/shelf`. It requires a quoted `updated` day, a `summary` (the
  intro under the heading and the page's description) and three arrays,
  `albums`, `films` and `books`, shown in that order. Each row needs `title`,
  `creator` (the artist, director or author), an integer `year` and its one
  `sentence`; `link` (an `https://` link on the row) is optional, and a film may
  have a `rating`, 0.5–5 in half steps. Rows keep their file order, and an empty
  array leaves its list out. `reading` (`title`, `creator`, and optionally
  `started`, a quoted `"YYYY-MM"`, and `page`), `lastWatched` (`title`, an
  integer `year`, a quoted `date` and an optional `rating`) and `listening`
  (`title`, `creator` and a positive integer `plays`) are the optional rows at
  the top; leave one out to hide it. The on-repeat row shows the most played
  album over the last 7 days from Last.fm. An unknown field fails the build, and
  `bun run check` names the file when the JSON itself is broken. Bump `updated`
  when you edit. Keep hex colour codes out of this file, and compare each page's
  `<style>` with the previous build after an edit, since Tailwind scans it.

## Music

[src/data/lastfm.ts](src/data/lastfm.ts) fetches the latest Last.fm value once
per build, with a five-second timeout. On failure it logs a warning and uses the
committed snapshot, which a normal build never rewrites. Artwork lookup has its
own timeout.

Without JavaScript, music widgets show the build-time track as idle, or `—` when
empty. With JavaScript, one [presence hub](src/scripts/presence-hub.ts) per page
updates them; pages without music widgets never poll. A visible page polls at
once, then 60 seconds after each success. Failures back off to 120, 240 and 600
seconds, and hidden pages stop polling. A failed poll keeps the last value, marks it offline and turns "now"
wording idle, with no error text for visitors.

[Artwork](src/data/artwork.ts) comes from MusicBrainz release search and Cover
Art Archive 250px thumbnails (including Internet Archive redirects), with no key.
Lookups and misses are cached until reload, MusicBrainz requests are at least
1.1 seconds apart, and a failure keeps the music glyph. Visitors' browsers talk
to Last.fm and these services directly, so those services see visitor IPs.

### Replace the Last.fm identifier

`apiKey` in [src/data/now-playing.ts](src/data/now-playing.ts) is a public,
read-only identifier that ships in browser code. It does not belong in Actions
secrets or `.env`.

1. Get a new one from [Last.fm's API account page](https://www.last.fm/api/account/create).
2. Change only the `apiKey` value, keeping the `gitleaks:allow: public and
   read-only` marker on its line. Change `user` only to show someone else's
   listening. Keep the identifier and request URLs out of logs and screenshots.
3. Run `bun test`, `bun run check` and `bun run build`. A fallback warning means
   the build used the snapshot, not that the new key works; confirm a fresh
   Last.fm response in the local widget.
4. Merge to `main` to deploy. Already open pages keep the old bundle until reload.

To rehearse, set the constant to `invalid-readme-example` in a disposable
checkout, build, and confirm the snapshot fallback. Never publish that copy.

### Refresh the offline snapshot

Back up the current JSON first. Stop playback and wait for Last.fm to show an
idle track. From the checkout root, this makes one request, maps it through the
site's own code and writes only an idle value; it prints neither the URL nor the
response, and leaves the file alone on an invalid, live or empty answer.

```sh
bun --eval '
import { writeFile } from "node:fs/promises";
import { recentTracks, toNowPlaying } from "./src/data/now-playing.ts";
let value;
try {
  const response = await fetch(recentTracks, { signal: AbortSignal.timeout(5000) });
  value = response.ok ? toNowPlaying(await response.json()) : null;
} catch {
  value = null;
}
if (value?.state !== "idle") {
  console.error("No idle value captured; snapshot unchanged.");
  process.exit(1);
}
await writeFile("src/data/snapshots/lastfm.json", JSON.stringify({ ...value, artwork: null }) + "\n");
'
bunx biome format --write src/data/snapshots/lastfm.json
bun test
bun run check
bun run build
```

Stop if the capture fails. Review the JSON before committing; keep `artwork:
null`, which selects the glyph and matches the snapshot test. Then run
`bun run gate` on macOS and compare each page's `<style>` and compressed HTML
size with the previous build, because Tailwind scans text under `src/` and a
track name can add a utility. Restore the backup if anything fails. Nothing
refreshes the snapshot on a schedule.

## Deployment and secrets

The `vedaant-dev` Cloudflare Pages project is connected to this repository and
builds every push itself, with no GitHub Actions deploy. Its build settings,
kept in the Cloudflare dashboard, are:

- Build command: `bun install --frozen-lockfile && bun run build`
- Build output directory: `dist`
- Environment variables: `BUN_VERSION=1.4.2`, `NODE_VERSION=24.14.1` and
  `SKIP_DEPENDENCY_INSTALL=1`

`main` is the production branch, so each push to it deploys
https://vedaantrajoo.com. A failed build leaves the previous deployment live.
Cloudflare does not wait for the gate or audit checks, so `main` should change
only through pull requests that require them.

Every other branch gets a preview at `<branch>.vedaant-dev.pages.dev`. A
Cloudflare Access policy limits previews to the owner, and Cloudflare marks them
`noindex`. Cloudflare keeps a branch's previews after the branch is deleted, so
[.github/workflows/previews.yml](.github/workflows/previews.yml) deletes them
when a branch is deleted. GitHub runs it from `main`'s copy of the file, so it
cleans up only branches deleted after it lands there.

The site has no adapter, Worker, Pages Function or server endpoint. Only the
preview cleanup gets these Actions secrets:

- `CLOUDFLARE_API_TOKEN`: permits deleting Pages deployments.
- `CLOUDFLARE_ACCOUNT_ID`: the account the token belongs to; not a credential.

Never put either in source or build environment variables. The site has no
application secrets. A future server secret must go through `astro:env/server`,
because `import.meta.env` inlines values into the build.

### Rotate the cleanup token

Keep the token at least scope, expiring within a year, with a reminder before
it does.

1. In Cloudflare's API Tokens settings, create a custom token with Account /
   Cloudflare Pages / Edit for the account that holds `vedaant-dev`. It needs no
   DNS permission or Global API Key.
2. Set its expiry to a year or less, record it privately and set a reminder.
3. Paste it straight into GitHub's Settings > Secrets and variables > Actions >
   `CLOUDFLARE_API_TOKEN`. Cloudflare shows it only once.
4. Once the next preview cleanup succeeds, revoke the old token. If it fails,
   check the account, permission and expiry.

See Cloudflare's guide to [token creation and TTL](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## Quality checks and maintenance

Run the local gate on macOS. It needs gitleaks (`brew install gitleaks`):

```sh
bun run gate
```

[scripts/gate.sh](scripts/gate.sh) runs diagnostics and tests, then builds with
the network blocked by `sandbox-exec`. gitleaks scans the git history and
`dist/` for secrets, and a grep rejects environment reads outside `astro:env`.
[scripts/pages.ts](scripts/pages.ts) checks that the music widgets show the
snapshot and that every page has a unique title and description. It also
enforces 5,120 B of gzipped executable JavaScript per page (JSON-LD does not
count) and reports HTML and CSS sizes against 30 KB and 12 KB gzip targets. The
gate then checks the CSP theme-script hash, contrast, and that colours come from
tokens. It rebuilds `dist/`. A failure prints the failing tool's output; redact
credentials and keyed URLs before sharing it.

[scripts/audit.sh](scripts/audit.sh) runs the launch audits after a build:
Lighthouse mobile at least 95 in every category, LCP at most 1.8 s and CLS 0
under Lighthouse's default simulated throttling, then axe with no violations in
light and dark. It serves `dist/` with Wrangler's Pages runtime, so `_headers`
apply, and needs Chrome, plus a matching chromedriver in `$CHROMEDRIVER` for axe.

For pull requests to `main`, the [gate workflow](.github/workflows/gate.yml) runs
the gate on macOS and the [audit workflow](.github/workflows/audit.yml) runs the
audits on Ubuntu, both without secrets. They block merges only if branch
protection requires them. Pushes to `main` run `check` and `build` only.

[public/_headers](public/_headers) sets the CSP and caching, and
[scripts/csp-hash.ts](scripts/csp-hash.ts) verifies the theme hash.
`astro preview` ignores `_headers`. Hashed `/_astro/` assets are immutable for a year, Pages
revalidates HTML, `dist/404.html` serves real 404s and `_redirects` handles
`/resume`.

Chores:

- Monthly: run the gate after a frozen install, and check Cloudflare Pages and
  GitHub Actions usage.
- Quarterly: review dependency updates and Astro's upgrade guide. Run
  `npx @astrojs/upgrade` on its own branch, since it edits package files, review
  majors, keep the Bun lockfile in sync and rerun the checks. Stay within 12
  direct packages and 20 components.
- Before the token expires, at least yearly: rotate it as above. The Last.fm
  identifier has no expiry.
- When work changes: update the résumé and its date. Keep `now.md` current.

Lasting choices: Bun locally, plain Markdown instead of MDX, static Pages,
Last.fm straight from the browser with a committed fallback, keyless artwork and
no analytics. Fonts are committed and load through Astro's Fonts API. Geist sans
is preloaded with `font-display: optional`, so a slow first visit may keep the
fallback font throughout; mono uses swap and the hero's serif is optional. CSS is
inlined into each page, so there is no `dist/_astro/*.css` to compare; compare
each page's `<style>` instead.

The gate and audits do not cover every launch check. Owner accessibility and
browser passes, domain cutover and the timed "add a project in under five
minutes" check happen at launch. Before then, the owner reads this
README cold and uses it to run the site, add a project and replace the Last.fm
identifier.
