# vedaant.dev

Vedaant Rajoo's Ledger site: Astro, plain Markdown and Tailwind CSS v4 over local
design tokens. Pages are static; music updates in the browser. The production
origin is **https://vedaantrajoo.com**. `vedaant.dev` is the project's name.

## Run locally

Use **Bun 1.4.2** and **Node 24.14.1**, the versions selected by
[deployment CI](.github/workflows/deploy.yml). The repository does not select your
local runtime versions automatically. From the checkout directory:

```sh
bun --version
node --version
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 4325
```

Open http://127.0.0.1:4325. Choose another unused port if necessary. Stop the dev
server before serving a production build on the same port:

```sh
bun run check
bun run build
bun run preview --host 127.0.0.1 --port 4325
```

`check` runs Biome and Astro diagnostics. Require Astro's `Result (` summary;
an exit code alone does not prove that Astro checked files. If Astro offers to
install its checker, answer **No** and run the frozen install again. `build`
first requires [public/resume.pdf](public/resume.pdf), then writes `dist/`.
`preview` serves that build; it does not update when source files change.

Use Ctrl-C for a foreground server. If the command returns while the server
keeps running, Astro selected background mode; `--background` also requests it
explicitly. Run `bun run dev stop` or `bun run preview stop` from that same
checkout to stop its background server.

No `.env` file or Cloudflare credentials are needed to run or build the site.
The first dependency install needs network access; subsequent builds can use the
committed fonts and music snapshot when external APIs are unavailable.

Other commands from [package.json](package.json):

- `bun test`: existing data tests.
- `bun run gate`: the full local gate, described below.
- `bun run fix`: Biome fixes; this **changes files**.

## Edit content

Content belongs in these files, not components. Collection fields are validated
by [src/content.config.ts](src/content.config.ts); site settings are validated by
[src/data/site.ts](src/data/site.ts).

| Content | File |
| --- | --- |
| Project rows and case studies | `src/content/projects/*.md` |
| Posts and notes | `src/content/writing/*.md` |
| Now page, city, building and watched rows | [src/content/now/now.md](src/content/now/now.md) |
| Work history | [src/data/work.json](src/data/work.json) |
| Name, hero, time zone, email, links and résumé date | [src/data/site.json](src/data/site.json) |
| Résumé PDF | [public/resume.pdf](public/resume.pdf) |
| Offline music value | [src/data/snapshots/lastfm.json](src/data/snapshots/lastfm.json) |

### Add a project in one file

Create `src/content/projects/readme-example.md` with the following contents.
This is a **fictional example for a disposable checkout**, not an owner project
to publish. Use your own file name and facts for a real entry.

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

Run `bun run check` and `bun run build`, then inspect `/projects` in the preview.
The example adds a row with no link. It has no case-study page and does not appear
on the home page. No component, page or index file needs editing.

The six fields above are required. `title` must be nonempty; `summary` is 1–90
characters; `year` is an integer from 1000 to 9999; `stack` accepts up to four
nonempty labels of at most 24 characters each. `status` is `active`, `done` or
`archived`; `featured` is a boolean.

Optional fields:

- `repo`: an `https://` repository URL. A row without a case study links here.
- `package`: a valid npm package name, including a scoped name if needed.
- `prs`: an `https://` link to your contributions; places the row in the open
  source group. Optional `start` is a quoted `YYYY-MM` month.
- `confidential: true`: suppresses repository/package/PR links and shows a
  confidentiality note. It does **not** hide metadata or an available case study.
- `draft`, `published`, `updated`: case-study controls described next.

`/projects` lists every project, including draft and archived rows. Home shows
only the two newest featured, non-archived rows, ordered by year and then file
id. `featured: true` does not guarantee a home slot. Archived rows stay on
`/projects` with their archived treatment.

### Turn that file into a case study

Add a body of at least 500 words and use `draft: true` while writing. The current
[hasCaseStudy()](src/data/projects.ts) counts whitespace-separated body tokens,
including Markdown and code syntax. A real study should include a real decision
and excerpt. Start body headings at `##`; the template supplies the only h1.

`bun run dev` exposes qualifying draft studies. A production build omits their
study pages, **but keeps their project metadata rows public**. Draft is not a
privacy control. A shorter body does not create a study page in either mode.

When ready to publish, remove `draft: true` or set it to `false`, and add the
actual publication day as a quoted string, for example
`published: "2026-10-23"`. The date is illustrative. A non-draft study without
`published` fails the build. Optional `updated: "2026-10-24"` must be strictly
later than `published`. Rebuild and inspect `/projects/<file-name>/`; the row now
opens the study before considering its repository link.

File names determine page ids and URLs. Keep them stable; a published slug change
also needs a redirect in [public/_redirects](public/_redirects), so it is no
longer a one-file edit. Currently `clai` is published and featured; `this-site`
remains a draft.

### Writing, feed and sitemap

A post or note is one Markdown file in `src/content/writing/`. Its required
frontmatter is `title`, `summary`, quoted `published: "YYYY-MM-DD"` and
`kind: post` or `kind: note`. `draft` defaults to `false`. Optional `updated`
must be on or after publication; unlike a project, the same day is allowed.
Optional `project` is the id of an existing project, without `.md`.

Start body headings at `##`. Use root-relative links such as `/projects/clai/`
for links within this site. [pieces()](src/data/writing.ts) includes drafts in
dev only. Production builds exclude writing drafts from lists, post pages and
the full-content RSS feed at `/feed.xml`. Home shows the two newest pieces.
Do not share a dev server if its draft content should stay private.

The feed accepts Markdown code fences, footnotes, images, tables and task lists.
Its [HTML reader](src/data/feed.ts) also accepts comments and these raw elements:

```text
a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt
em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q s
samp section small span strong sub summary sup table tbody td tfoot th thead time
tr u ul var wbr
```

The page's h1 restriction still applies. Other elements, including `svg`, `math`,
`iframe`, `video`, `audio`, `picture`, `script`, `style`, `textarea` and `title`,
fail the build. So do malformed tags, CDATA, `<?`, NUL characters and these
attributes: `srcset`, `cite`, `ping`, `longdesc`, `background`, `itemid`, `itemtype`.
URL character references are limited to supported numeric references and
`amp`, `lt`, `gt`, `quot`, `apos`; unsupported or invalid references fail rather
than being guessed. Ordinary URL query strings are supported. The error names
the post. Expanding this reader requires a code change with tests.

[src/pages/feed.xml.ts](src/pages/feed.xml.ts) resolves body links and images to
absolute URLs. [astro.config.mjs](astro.config.mjs) generates
`/sitemap-index.xml` and `/sitemap-0.xml` from built pages, plus `/resume.pdf`.
Draft study/post pages, the 404 and dev-only `/_states` are absent. The feed has
its own discovery link in every page and in the footer. Pages currently serves
it as `application/xml`, which feed readers accept. If the production origin
changes, update `site`, sitemap `customPages` and [public/robots.txt](public/robots.txt)
together.

### Now, work and résumé

- `now.md` is the only file read from its directory. Its frontmatter requires
  quoted `updated`, `from` (city), `building`, and `watched` with `title`, integer
  `year` and quoted `date`. Optional `rating` is 0.5–5 in half-star steps. Its body
  starts with plain lowercase `## label` sections containing paragraphs only,
  with at most 400 words across the prose. Links, emphasis, strikethrough, code
  spans and line breaks are supported; lists, images and code blocks are not.
  Labels must be unique. Update its date when editing; launch requires a date
  within the preceding 14 days. The page marks it stale after 60 whole days.
- `work.json` is a nonempty object keyed by stable role ids. Each value needs
  `employer`, `role`, quoted `start: "YYYY-MM"`, `end` (a quoted month or `null`
  for an ongoing role) and a 1–140 character `summary`. Optional `url` uses
  `https://`; an end cannot precede its start. Home keeps the newest two roles
  and every ongoing role visible, folding a remaining tail of two or more ended
  roles behind “earlier”. A lone trailing role stays visible. The optional
  `collapse` field is accepted by the schema but does not control that folding.
- Replace `public/resume.pdf` when work changes, date the PDF, and set
  `resume.updated` in `src/data/site.json` to the same quoted day. `/resume`
  redirects to `/resume.pdf` on Pages. The build checks that the file exists;
  it cannot check whether the PDF and displayed date are truthful.

## Music and failures

[src/data/lastfm.ts](src/data/lastfm.ts) requests the latest Last.fm value once
per build. Its request and response body share a five-second timeout. A failed
request or unusable response logs a warning and uses the committed
`src/data/snapshots/lastfm.json`. A normal build **never rewrites that file**.
Artwork lookup has its own timeout, so five seconds is not a whole-build limit.

Without JavaScript, music widgets show the build-time track as idle, or an empty
value as `—`. With JavaScript, one [presence hub](src/scripts/presence-hub.ts)
per page updates the music widgets. Pages without those widgets do not poll.
Visible pages poll immediately, then 60 seconds after a successful answer.
Successive failures wait 120, 240 and 600 seconds; a longer Last.fm
`Cache-Control: max-age` takes precedence. Hidden pages pause new requests.

A failed poll keeps the last value and marks it offline without visitor error
text. A formerly live track changes to idle wording so it no longer says “now”.
An empty widget stays empty. A suspended identifier or service outage therefore
leaves useful static content rather than preventing the site from loading.

[Artwork](src/data/artwork.ts) uses MusicBrainz release search and Cover Art
Archive 250px thumbnails, including Internet Archive redirects. It needs no key.
Lookups, including misses, are cached for the page's lifetime; reload retries.
MusicBrainz requests from that page are at least 1.1 seconds apart. Failure keeps
the music glyph and text. These thumbnails are exempt from the normal 20 KB
image target. Visitors' browsers contact Last.fm and the artwork services, so
those services receive the visitors' IP addresses.

### Replace the public Last.fm identifier

The `apiKey` constant in [src/data/now-playing.ts](src/data/now-playing.ts) is a
**public, read-only identifier**. It ships in browser code. It is not a runtime
secret and does not belong in GitHub Actions secrets or `.env`.

1. Obtain a replacement through [Last.fm's API account page](https://www.last.fm/api/account/create).
2. Edit only the value of `apiKey` in `src/data/now-playing.ts`. Keep the
   `gitleaks:allow: public and read-only` marker on that line. Keep `user` unless
   you intend to change whose listening history the site shows. Do not paste the
   identifier or a request URL into logs, screenshots or this README.
3. Run `bun test`, `bun run check` and `bun run build`. A fallback warning means
   the build succeeded from the snapshot; it does **not** prove the replacement
   works. Check the local music widget with network access, without exposing the
   request URL. A fresh successful Last.fm response is the functional check.
4. After the normal review and deployment process, new visitors receive the
   rebuilt bundle. Editing source alone does not update a deployed site or an
   already open page. A snapshot refresh is optional.

To rehearse safely, use a disposable checkout and replace the constant with a
deliberately invalid string such as `invalid-readme-example`. Build it and
confirm the snapshot fallback. Never publish that copy. This tests replacement
instructions and failure behavior, not the validity of a real new identifier.

### Refresh the offline snapshot manually

Keep a backup of the existing JSON until validation passes. Stop playback and
wait for Last.fm to record an idle scrobble. From the checkout root, this command
makes one request, maps it through the same code as the site, and writes only an
idle value. Invalid, live and empty responses leave the existing file unchanged.
The command prints neither the request URL nor its response.

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

Stop if capture fails; do not continue with the commands below it. Review the
JSON before publication: it contains only the displayed music value, not a raw
API response. Keep the `artwork` field; `null` selects the glyph fallback and
preserves the shape expected by the existing snapshot test. Successful online
lookups can supply artwork later. Run `bun run gate` on macOS. Compare the built pages'
`<style>` contents and compressed HTML sizes with a build before the refresh;
Tailwind scans text under `src/`, so even a track name can add a CSS utility.
Restore the backup if the write or validation fails. No scheduled refresh exists.

## Deployment and secrets

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) is the current
deployment procedure. A push to **`ledger_mvp` only** runs on Ubuntu, installs
with `bun install --frozen-lockfile`, runs `check` and `build`, then uses
**Wrangler 4.150.0** to upload only `dist/` to the **`vedaant-dev`** Cloudflare
Pages Direct Upload project. The upload records the actual branch and commit.

This creates a preview, available at https://ledger-mvp.vedaant-dev.pages.dev/
and the configured custom alias https://ledger-mvp.vedaantrajoo.com/. Pages
previews use `noindex`; [public/_headers](public/_headers) supplies that rule for
the custom alias. Canonical, feed and sitemap URLs still name the production
origin. Do not interpret preview SEO results as production validation.

`main` is the Pages project's production branch, but this workflow does not run
on `main`. Production cutover and its deployment trigger remain separate launch
work. There is no scheduled rebuild, manual-dispatch trigger or PR gate workflow.
The site uses no adapter, Worker, Pages Function or application server endpoint.

Only the upload step receives these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`: the credential that permits a Pages upload.
- `CLOUDFLARE_ACCOUNT_ID`: the account identifier, stored alongside the token;
  it is not itself an authentication token.

Do not put either value in source, this README or build environment variables.
There are no application secrets to configure now. Any future server-secret
integration must use `astro:env/server`; `import.meta.env` can inline values into
the build. The public Last.fm identifier is the deliberate exception.

A failed check/build prevents upload. A failed upload or expired deployment
token leaves the previous static deployment available. Inspect the failed job,
fix and validate the source or update the appropriate Actions secret, then
retry the authorized deployment. Do not treat a green local build as evidence
that an upload credential works.

### Rotate the deployment token

The maintenance policy is least scope, **expiry no more than one year away**,
and a calendar reminder before expiry. This README does not attest to the
current token's expiry or an existing reminder.

1. In Cloudflare's API Tokens settings, create a replacement custom token with
   **Account / Cloudflare Pages / Edit**, restricted to the account containing
   `vedaant-dev`. Uploads do not require DNS-edit permission or a Global API Key.
2. Set the token's TTL/expiry to at most one year. Record the actual expiry in
   your private maintenance record and create your own calendar reminder early
   enough to replace it before it expires.
3. Copy the new token directly into the repository's GitHub **Settings > Secrets
   and variables > Actions > CLOUDFLARE_API_TOKEN** secret. Keep the account id
   unchanged unless the account itself changes. Never paste the token into chat
   or commit it. Cloudflare shows the secret only once.
4. Validate it with the next authorized preview deployment. Once that upload
   succeeds, revoke the old token and confirm the new expiry/reminder record.
   If it fails, check the selected account, permission and expiry before retrying.

Cloudflare documents [token creation and TTL](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
and [Pages uploads from CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).
This project uses direct Wrangler uploads; examples of other CI actions in those
guides do not change the committed workflow. There is no current GitHub PAT,
WakaTime key or Vercel secret to rotate.

## Quality checks and maintenance

After installing dependencies, run the local gate on **macOS**:

```sh
bun run gate
```

[scripts/gate.sh](scripts/gate.sh) runs diagnostics and tests, builds with remote
network access blocked by `sandbox-exec`, checks snapshot widgets, enforces
**5,120 B gzip executable JavaScript per page**, reports HTML/CSS sizes, scans
for secrets/environment reads, checks the CSP theme-script hash, measures
contrast and checks token-only colours. JSON-LD is data, not executable JS.
HTML and CSS targets are 30 KB and 12 KB gzip respectively; inspect their reports.
The gate rebuilds `dist/`, so use a separate checkout if a preview must stay
unchanged. Failure names the individual command to rerun; inspect its output
privately and redact credentials/keyed URLs before sharing it.

The offline gate needs macOS `sandbox-exec`. Ubuntu deployment CI currently runs
`check` and `build`, not this gate. Lighthouse and axe are on-demand tools, not
dependencies or part of the gate. The pinned audit commands are in the gate
script's header; use free local ports and a Chrome-compatible axe driver.
`astro preview` ignores `_headers`: use Wrangler's local Pages runtime when
auditing real response headers. [public/_headers](public/_headers) controls CSP
and caching; [scripts/csp-hash.ts](scripts/csp-hash.ts) verifies the theme hash.
Hashed `/_astro/` assets are immutable for a year. Pages revalidates HTML and
serves a real 404 using `dist/404.html`; `/resume` routing comes from `_redirects`.

Recurring chores:

- **Monthly:** run an offline gate after a frozen install; inspect Cloudflare
  Pages and GitHub Actions usage against the account's included allowances.
  Static hosting does not imply unlimited Actions minutes.
- **Quarterly:** review dependency updates and Astro's upgrade guide. Run
  `npx @astrojs/upgrade` only as a deliberate dependency change on a separate
  branch; it changes package files. Review majors before applying them, keep
  the Bun lockfile consistent and rerun checks. Stay within 12 direct packages
  and 20 components; there are currently eight packages and fourteen components.
- **Before token expiry, and at least yearly:** review deployment-token scope,
  replace it using the procedure above, and check the next expiry/reminder.
  Review the public Last.fm integration separately; it is not a secret with a
  fabricated annual expiry.
- **When work changes:** regenerate/date the résumé and update its displayed
  date. Keep `now.md` current. Refresh the offline music snapshot when useful.

Durable choices: Bun locally; plain Markdown rather than MDX; static Pages;
Last.fm directly from the browser with a committed fallback; keyless artwork;
no analytics at launch. Fonts are committed and loaded through Astro's Fonts
API. Geist sans is preloaded with `font-display: optional`: a slow first visit
can keep the adjusted fallback for the whole visit. Mono keeps swap; the hero's
serif is optional. CSS is inlined into each page, which increases HTML size and
removes a separate stylesheet request. Compare page `<style>` text when checking
CSS changes; do not assume a `dist/_astro/*.css` file exists.

Passing these commands does not close every launch check. Owner accessibility
and browser passes, the 1.2-second LCP target under the agreed simulated profile,
Cloudflare configuration follow-up and production cutover checks remain separate.
The owner must also read this README cold and demonstrate running the site,
adding a project and following identifier replacement from these instructions.
The timed under-five-minutes production publication check belongs to launch;
a disposable example is only a rehearsal.
