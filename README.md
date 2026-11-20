# vedaant.dev

Vedaant Rajoo's Ledger site, built with Astro, plain Markdown and Tailwind CSS v4
over local design tokens. Pages are static, and Pages Functions serve the live
music value, the daily coding snapshot, the daily contributions calendar and
`/shelf`'s three live rows. The site lives at
https://vedaantrajoo.com; `vedaant.dev` is only the project's name.

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
