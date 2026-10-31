import { ago, minute } from './now-playing';

// The same public value at build and in the hub; private WakaTime fields never reach the page.
export interface Coding {
  state: 'idle' | 'empty';
  language: string | null;
  // Today's coding time, "2h 10m".
  today: string | null;
  // The last heartbeat, coarsened to the minute.
  at: string | null;
  shares: Share[];
}

// WakaTime requires an OAuth access token for reads; plugin API keys are write-only.
export const statusBar = 'https://wakatime.com/api/v1/users/current/status_bar/today';
export const currentUser = 'https://wakatime.com/api/v1/users/current';
export const lastMonth = 'https://wakatime.com/api/v1/users/current/stats/last_30_days';
export const authorization = (key: string) => ({ Authorization: `Bearer ${key}` });

// "2h 10m", "45m", or "0m" under a minute.
export const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

// An empty day can still have a 30-day mix; malformed or unfinished stats fail the whole answer.
export function toCoding(bar: unknown, user: unknown, stats: unknown): Coding | null {
  const data = (bar as { data?: { grand_total?: unknown; languages?: unknown } } | null)?.data;
  const seconds = (data?.grand_total as { total_seconds?: unknown } | undefined)?.total_seconds;
  const languages = data?.languages;
  const heartbeat = (user as { data?: { last_heartbeat_at?: unknown } } | null)?.data
    ?.last_heartbeat_at;
  const shares = toShares(stats);
  const heard =
    heartbeat === null || (typeof heartbeat === 'string' && !Number.isNaN(Date.parse(heartbeat)));
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    !Array.isArray(languages) ||
    !heard ||
    !shares
  ) {
    return null;
  }
  const time = typeof heartbeat === 'string' ? Date.parse(heartbeat) : Number.NaN;
  if (seconds < 60) {
    return { state: 'empty', language: null, today: null, at: null, shares };
  }
  if (Number.isNaN(time)) {
    return null;
  }
  const top = languages
    .filter((entry) => typeof entry?.name === 'string' && typeof entry.total_seconds === 'number')
    .sort((a, b) => b.total_seconds - a.total_seconds)[0]?.name;
  return {
    state: 'idle',
    language: language(top),
    today: duration(seconds),
    // Coarsened to the minute, for privacy.
    at: new Date(Math.floor(time / 60_000) * 60_000).toISOString(),
    shares,
  };
}

// The languages the cell may name. A plugin can report any string as a language, so an unknown one,
// which could be a project or file name, is none: the cell then reads "coding". Add a name here to
// show it.
const known = new Set(
  `Astro Bash C C# C++ CSS Clojure Dart Docker Elixir Elm Erlang F# Fish Go GraphQL Groovy HCL HTML
  Haskell Java JavaScript JSON JSX Julia Kotlin Lua Makefile Markdown Nix OCaml Objective-C PHP Perl
  PowerShell Python R Ruby Rust SCSS SQL Scala Shell Svelte Swift TOML TSX TypeScript Vue XML YAML
  Zig`.split(/\s+/),
);
const language = (value: unknown) => (typeof value === 'string' && known.has(value) ? value : null);
const states = new Set<unknown>(['idle', 'empty']);

// Checks a parsed /api/coding body in the form the Function writes; null for
// anything else, so the hub treats it as a failure.
export function codingFromLive(body: unknown): Coding | null {
  const { state, language: name, today, at, shares } = (body ?? {}) as Record<string, unknown>;
  const validShares =
    Array.isArray(shares) &&
    shares.length <= 6 &&
    shares.every(
      (share, i) =>
        (share?.name === 'other'
          ? i === shares.length - 1
          : language(share?.name) === share?.name && typeof share?.name === 'string') &&
        Number.isInteger(share?.percent) &&
        share.percent > 0 &&
        share.percent <= 100,
    ) &&
    new Set(shares.map(({ name }) => name)).size === shares.length &&
    (shares.length < 6 || shares[5].name === 'other') &&
    (shares.length === 0 || shares.reduce((sum, { percent }) => sum + percent, 0) === 100);
  const valid =
    typeof body === 'object' &&
    states.has(state) &&
    // Only an empty day has no time, so an idle cell always has one to show.
    (state === 'empty') === (today === null) &&
    (name === null || language(name) === name) &&
    (today === null || (typeof today === 'string' && /^(?:\d+h )?\d+m$/.test(today))) &&
    (at === null || minute(at)) &&
    validShares;
  return valid
    ? ({
        state,
        language: name,
        today,
        at,
        shares: (shares as Share[]).map(({ name, percent }) => ({ name, percent })),
      } as Coding)
    : null;
}

// The /now cell's text: today's time, the day's top language, and the last heartbeat's age.
// Empty, or offline with nothing known, reads "—".
export function codingText({ language: name, today, at }: Coding) {
  if (!today) {
    return { today: '—', language: '', time: '' };
  }
  return {
    today: `${today} today`,
    language: name ? `top language ${name}` : '',
    time: at ? `last heartbeat ${ago(at)}` : '',
  };
}

// One share of the 30-day language mix, in whole percent; 'other' gathers the rest.
export interface Share {
  name: string;
  percent: number;
}

// Maps ready last_30_days stats into shares that sum to 100; incomplete stats retry on the next poll.
// Only the top five known languages are named; the rest join 'other' to keep the card compact.
export function toShares(body: unknown): Share[] | null {
  const stats = (
    body as { data?: { languages?: unknown; range?: unknown; is_up_to_date?: unknown } } | null
  )?.data;
  const data = stats?.languages;
  if (stats?.range !== 'last_30_days' || stats.is_up_to_date !== true || !Array.isArray(data)) {
    return null;
  }
  const totals = new Map<string, number>();
  for (const entry of data) {
    const percent = entry?.percent;
    if (
      typeof entry?.name !== 'string' ||
      typeof percent !== 'number' ||
      !Number.isFinite(percent) ||
      percent < 0 ||
      percent > 100
    ) {
      return null;
    }
    const name = language(entry?.name) ?? 'other';
    totals.set(name, (totals.get(name) ?? 0) + percent);
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum)) {
    return null;
  }
  if (sum <= 0) {
    return [];
  }
  const ranked = [...totals]
    .filter(([name]) => name !== 'other')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const other = ranked
    .slice(5)
    .reduce((total, [, value]) => total + value, totals.get('other') ?? 0);
  const parts = [...ranked.slice(0, 5), ['other', other] as const].map(([name, value]) => ({
    name,
    exact: (value / sum) * 100,
  }));
  // Largest remainder: whole percents that sum to exactly 100, in the same order on every build.
  const shares = parts.map(({ name, exact }) => ({ name, percent: Math.floor(exact) }));
  const missing = 100 - shares.reduce((a, { percent }) => a + percent, 0);
  const order = parts
    .map(({ exact }, i) => ({ i, left: exact - Math.floor(exact) }))
    .sort((a, b) => b.left - a.left || a.i - b.i);
  for (const { i } of order.slice(0, missing)) {
    shares[i].percent++;
  }
  return shares.filter(({ percent }) => percent > 0);
}
