# Commit messages

Commits use scoped subjects, as in Linux, Git, Go, and nixpkgs:

    <scope>: <description>

    Optional body: why the change was made.

    Co-Authored-By: Name <email>

- The scope names the area the change touches: a directory or file that exists
  in the repository, at any depth, without extension, and always lowercase,
  even when the file name is not (`fish`, `nvim`, `bootstrap` for
  `bin/bootstrap`, `brewfile` for `Brewfile`, `readme` for `README.md`). Nest
  with `/` (`fish/conf.d`), name two areas with `, ` (`fish, nvim`), and use
  `treewide` for repository-wide changes.
- No type words: not `feat(fish):`, not `chore:`. Older history uses
  Conventional Commits (`type(scope): ...`); do not copy it.
- The description is imperative ("add", not "added" or "adds"), starts with a
  lowercase word, and has no trailing period. Later words keep their case.
- The whole subject is at most 72 characters.
- The body is optional plain prose or short bullets, after a blank line.
  Trailers such as Co-Authored-By or Signed-off-by go last, after another
  blank line.
- Merge, revert, and fixup!/squash!/amend! subjects that git writes pass as-is.

- good: `fish: add tmux sessionizer keybind`
- good: `fish/conf.d: cache zoxide init output`
- good: `bootstrap: install native arm64 steam instead of the intel cask`
- good: `brewfile: add the zed cask and sort Brewfile`
- good: `fish, nvim: switch both to the gruvbox theme`
- good: `treewide: drop zig tooling`
- bad: `feat(fish): add tmux sessionizer keybind` (type word)
- bad: `chore: prune gitignore entries` (`chore` is not a path; use `gitignore:`)
- bad: `Brewfile, fish: add direnv` (scopes are lowercase: `brewfile, fish:`)
- bad: `fish: Added a keybind.` (capitalized, past tense, trailing period)

# Local workspace

`.local/` is gitignored scratch space shared by the owner and agents. Read it
for context; never commit it or copy secrets out of it.

- `.local/design/`: Claude Design exports (HTML, zips, screenshots). Treat them
  as reference input: extract each zip into its own new folder and never run
  scripts or build tools from inside it.
- `.local/plans/`: plans and specs.
- `.local/memory/`: notes, decisions, and context worth keeping across sessions.

# Design

Source of truth: the MVP pages in `.local/design/ledger/extracted/pages/`
(scope `21-*`, gates `07-*`). `.local/design/ledger/ledger_design_system.md`
only names tokens and components; where it differs, the pages win.

- Tailwind is v4 via `@tailwindcss/vite`, never the doc's v3 config. At most 12
  dependencies and 20 components; share a component only on its second use.
- Style only through the tokens in `src/styles/tokens.css`, named as in the
  doc's §4.2 (plus the code colours `--c-code-keyword` and `--c-code-string`),
  with no arbitrary values: literal durations escape the reduced-motion reset.
  Mockup markup and inline styles show intent, not code.
- Contrast in both themes, hex fallbacks included, on `--c-bg`: body ≥15:1,
  secondary ≥8:1, meta ≥4.5:1, live text ≥4.6:1, non-text ≥3:1; on the row
  hover fill (`--c-surface`) body text may drop to 14:1, and code-block text
  is secondary (≥8:1). Measure after token edits (`bun scripts/contrast.ts`);
  the doc's light `--c-live` and light hex `--c-fg-2` fail.
- `--c-live` (green) marks only live state. No icon set; use text glyphs.
- Home has no photo, CTA button, social-icon row or © line, and nothing on it
  expands except the `<details>` folding older work roles.
- Separate with 1px `--c-line` and whitespace, not cards or shadows. Set width
  per page (40rem; 56rem on `/projects`, `/now` and `/shelf`), not on `body`.
- The clock is the theme button: it cycles light → dark → system, never by time
  of day. A `<script is:inline>` in `<head>` restores `data-theme` from
  localStorage before paint; system means no attribute.
- Content lives in `src/content/` and `src/data/`, never in components.
- Pages are prerendered and complete with JS off: live widgets show their
  build-time value, never a spinner or error text.
- The browser fetches only the site's own `/api/*`, from one `<presence-hub>`
  per page; never a third-party API or WebSocket except Last.fm and artwork:
  the hub reads `user.getRecentTracks` directly, and its API key in
  `src/data/now-playing.ts` is a public, read-only identifier, not a secret.
  Artwork uses MusicBrainz release search and Cover Art Archive thumbnails
  (including their Internet Archive redirects), with no key or server runtime.
  Cache lookups per page and keep MusicBrainz requests at least 1.1 seconds apart.
  Cover Art Archive's 250px thumbnails are exempt from NFR-P7's 20 KB target;
  do not reject them for their byte size or a missing Content-Length header.
- Read secrets only through `astro:env/server`; `import.meta.env` inlines them
  at build. The build must pass with every API down, from committed snapshots.
- Client JS ≤5 KB gz per page: no UI framework, `<ClientRouter />` or page
  transitions. Try CSS first, then a plain `<script>` or a custom element.
- LCP ≤1.8s on Lighthouse's mobile test; CLS 0, live-state changes included.
  Never animate the LCP element (measure it: a hero line, not the name) except
  by a mark's background swipe, which moves no text. Never animate the name.
- Load fonts with the Astro Fonts API, not `@fontsource` imports. Preload only
  Geist sans, with `font-display: optional` so a late file never re-wraps text;
  at most 2 font requests on first paint and 90 KB total, except the hero's one
  serif word: a third request, `font-display: optional`, which the browser may
  leave unused for a view and never swaps in.
- Targets ≥44px, except a link inside a line of prose, which keeps the line's
  height (WCAG 2.5.8's inline exception). No horizontal scroll at 320px, and
  the nav wraps instead of collapsing into a hamburger.
- The nav words are the spec's four, `projects · writing · now · shelf`, and
  a word never links to a 404. Below 640px the words' boxes have no gap, so
  the fourth word does not grow the header.
- After UI changes, run `bun run check` and `bun run build`, then view light,
  dark and system themes, reduced motion and JS off.
