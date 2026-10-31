import { ago, minute } from './now-playing';

// The coding row's value, the same at build, in the Function's answer and in the hub. Only the
// day's top language is exposed (FR-CD-1): never a project, branch, file or editor.
export interface Coding {
  state: 'live' | 'idle' | 'empty';
  language: string | null;
  // Today's coding time, "2h 10m".
  today: string | null;
  // The last heartbeat, coarsened to the minute.
  at: string | null;
}

// WakaTime's API reads the secret key as HTTP Basic auth: the key alone, base64-encoded.
export const statusBar = 'https://wakatime.com/api/v1/users/current/status_bar/today';
export const currentUser = 'https://wakatime.com/api/v1/users/current';
export const authorization = (key: string) => ({ Authorization: `Bearer ${key}` });

// A heartbeat this recent means the owner is coding now.
const liveFor = 15 * 60_000;
const none: Coding = { state: 'empty', language: null, today: null, at: null };

// "2h 10m", "45m", or "0m" under a minute.
export const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

// Maps parsed status_bar/today and users/current bodies; null when either is not one. A day with
// no coding time is empty, whatever the last heartbeat says.
export function toCoding(bar: unknown, user: unknown, now = Date.now()): Coding | null {
  const data = (bar as { data?: { grand_total?: unknown; languages?: unknown } } | null)?.data;
  const seconds = (data?.grand_total as { total_seconds?: unknown } | undefined)?.total_seconds;
  const languages = data?.languages;
  const heartbeat = (user as { data?: { last_heartbeat_at?: unknown } } | null)?.data
    ?.last_heartbeat_at;
  // Both bodies must be WakaTime's, an empty day included: a finite total, and a heartbeat that is
  // a valid time or null.
  const heard =
    heartbeat === null || (typeof heartbeat === 'string' && !Number.isNaN(Date.parse(heartbeat)));
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    !Array.isArray(languages) ||
    !heard
  ) {
    return null;
  }
  const time = typeof heartbeat === 'string' ? Date.parse(heartbeat) : Number.NaN;
  if (seconds < 60) {
    return none;
  }
  if (Number.isNaN(time)) {
    return null;
  }
  const top = languages
    .filter((entry) => typeof entry?.name === 'string' && typeof entry.total_seconds === 'number')
    .sort((a, b) => b.total_seconds - a.total_seconds)[0]?.name;
  return {
    state: now - time < liveFor ? 'live' : 'idle',
    language: language(top),
    today: duration(seconds),
    // Coarsened to the minute, for privacy.
    at: new Date(Math.floor(time / 60_000) * 60_000).toISOString(),
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
const states = new Set<unknown>(['live', 'idle', 'empty']);

// Checks a parsed /api/coding body: the four fields in the form the Function writes; null for
// anything else, so the hub treats it as a failure.
export function codingFromLive(body: unknown): Coding | null {
  const { state, language: name, today, at } = (body ?? {}) as Record<string, unknown>;
  const valid =
    typeof body === 'object' &&
    states.has(state) &&
    // Only an empty day has no time, so a live or idle cell always has one to show.
    (state === 'empty') === (today === null) &&
    (name === null || language(name) === name) &&
    (today === null || (typeof today === 'string' && /^(?:\d+h )?\d+m$/.test(today))) &&
    (at === null || minute(at));
  return valid ? ({ state, language: name, today, at } as Coding) : null;
}

// The /now cell's text: the language, today's time, and "now" or the age of the last heartbeat.
// Empty, or offline with nothing known, reads "—".
export function codingText(state: string, { language: name, today, at }: Coding) {
  if (!today) {
    return { language: '—', today: '', time: '' };
  }
  return {
    language: name ?? 'coding',
    today: `${today} today`,
    time: state === 'live' ? 'now' : (at && ago(at)) || '',
  };
}
