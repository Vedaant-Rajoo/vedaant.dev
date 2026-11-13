// The same public value at build and in the hub; private WakaTime fields never reach the page.
export interface Coding {
  state: 'idle' | 'empty';
  language: string | null;
  // The coding time of the newest day of the last seven with a minute or more, "2h 10m".
  today: string | null;
  // The last heartbeat, coarsened to the minute for privacy; null when it is not on that day.
  at: string | null;
  shares: Share[];
}

// WakaTime requires an OAuth access token for reads; plugin API keys are write-only.
// The daily summaries of the last seven days, today last, with the days in `zone`, site.timeZone.
export const lastWeek = (zone: string) =>
  `https://wakatime.com/api/v1/users/current/summaries?range=Last+7+Days&timezone=${encodeURIComponent(zone)}`;
export const currentUser = 'https://wakatime.com/api/v1/users/current';
export const lastMonth = 'https://wakatime.com/api/v1/users/current/stats/last_30_days';
export const authorization = (key: string) => ({ Authorization: `Bearer ${key}` });

// "2h 10m", "45m", or "0m" under a minute.
export const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

// The newest day of the week's summaries with a minute or more of coding, so a day that has barely
// begun still shows the last one; empty only when no day has a minute. A week without coding can
// still have a 30-day mix; a malformed day, or unfinished stats, fail the whole answer.
export function toCoding(week: unknown, user: unknown, stats: unknown): Coding | null {
  const days = (week as { data?: unknown } | null)?.data;
  const heartbeat = (user as { data?: { last_heartbeat_at?: unknown } } | null)?.data
    ?.last_heartbeat_at;
  const shares = toShares(stats);
  const heard =
    heartbeat === null || (typeof heartbeat === 'string' && !Number.isNaN(Date.parse(heartbeat)));
  const summaries = Array.isArray(days) ? days.map(toDay) : [];
  if (summaries.length === 0 || summaries.includes(null) || !heard || !shares) {
    return null;
  }
  const day = (summaries as Day[])
    .filter(({ seconds }) => seconds >= 60)
    .sort((a, b) => b.start - a.start)[0];
  if (!day) {
    return { state: 'empty', language: null, today: null, at: null, shares };
  }
  const time = typeof heartbeat === 'string' ? Date.parse(heartbeat) : Number.NaN;
  if (Number.isNaN(time)) {
    return null;
  }
  return {
    state: 'idle',
    language: language(day.top),
    today: duration(day.seconds),
    // Only a heartbeat on that day: a later one, from a day with under a minute, would pair its
    // date with another day's time. range.end is the day's last whole second.
    at:
      time >= day.start && time < day.end + 1_000
        ? new Date(Math.floor(time / 60_000) * 60_000).toISOString()
        : null,
    shares,
  };
}

interface Day {
  seconds: number;
  // The day's first and last second, from its range, as instants.
  start: number;
  end: number;
  // The name WakaTime gives the day's most-used language, unchecked.
  top: unknown;
}

// One day of WakaTime's summaries, or null when it is not one.
function toDay(value: unknown): Day | null {
  const { grand_total, languages, range } = (value ?? {}) as Record<string, unknown>;
  const seconds = (grand_total as { total_seconds?: unknown } | undefined)?.total_seconds;
  const { start, end } = (range ?? {}) as { start?: unknown; end?: unknown };
  const from = typeof start === 'string' ? Date.parse(start) : Number.NaN;
  const to = typeof end === 'string' ? Date.parse(end) : Number.NaN;
  // One day, 23 to 25 hours across a clock change, less its last second; a longer range would
  // pair the next day's heartbeat with this day's time.
  const span = to - from;
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    !Array.isArray(languages) ||
    !(span >= 82_799_000 && span <= 89_999_000)
  ) {
    return null;
  }
  const top = languages
    .filter((entry) => typeof entry?.name === 'string' && typeof entry.total_seconds === 'number')
    .sort((a, b) => b.total_seconds - a.total_seconds)[0]?.name;
  return { seconds, start: from, end: to, top };
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
// The tooltip glyphs on the mix bar that are not the name's lowercase extension, ".go" for Go. The
// page hands them to its script in an attribute, so they stay out of the /now JS budget.
export const tags: Record<string, string> = {
  'C#': '.cs',
  'C++': '.cpp',
  Clojure: '.clj',
  Docker: 'Dockerfile',
  Elixir: '.ex',
  Erlang: '.erl',
  'F#': '.fs',
  Haskell: '.hs',
  JavaScript: '.js',
  Julia: '.jl',
  Kotlin: '.kt',
  Makefile: 'Makefile',
  Markdown: '.md',
  OCaml: '.ml',
  'Objective-C': '.m',
  Perl: '.pl',
  PowerShell: '.ps1',
  Python: '.py',
  Ruby: '.rb',
  Rust: '.rs',
  Shell: '.sh',
  TypeScript: '.ts',
  other: '…',
};
// A share's glyph from tags, or from the page's copy of them. Shares name only known languages and
// 'other', so no name is an Object key.
export const tag = (glyphs: Record<string, string>, name: string) =>
  glyphs[name] ?? `.${name.toLowerCase()}`;
const language = (value: unknown) => (typeof value === 'string' && known.has(value) ? value : null);
const states = new Set<unknown>(['idle', 'empty']);
// A whole minute in toISOString's form, as now-playing.ts's minute(); repeated so the /now cell's
// script imports nothing from the module every page loads, which would split it into a chunk.
const minute = (value: unknown) => {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return time % 60_000 === 0 && new Date(time).toISOString() === value;
};

// Checks the coding value of a parsed /api/activity body in the form the Function writes; null for
// anything else, so the hub treats it as a failure.
export function codingFromLive(body: unknown): Coding | null {
  const value = (body as { coding?: unknown } | null)?.coding;
  const { state, language: name, today, at, shares } = (value ?? {}) as Record<string, unknown>;
  const validShares =
    Array.isArray(shares) &&
    shares.length <= 6 &&
    shares.every(
      (share, i) =>
        (share?.name === 'other' ? i === shares.length - 1 : known.has(share?.name)) &&
        Number.isInteger(share?.percent) &&
        share.percent > 0,
    ) &&
    new Set(shares.map(({ name }) => name)).size === shares.length &&
    (shares.length < 6 || shares[5].name === 'other') &&
    (shares.length === 0 || shares.reduce((sum, { percent }) => sum + percent, 0) === 100);
  // Only an object has a state, so states.has also rejects every other value.
  const valid =
    states.has(state) &&
    // Only an empty day has no time, so an idle cell always has one to show.
    (state === 'empty') === (today === null) &&
    language(name) === name &&
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

// The /now cell's text: the day's time and top language, and the last heartbeat's minute in the
// owner's zone, as the clock shows it: the cell's data-zone, site.timeZone. The day is the newest
// of the last seven with a minute of coding, and the value can be kept a day more by the build or
// by /api/activity, so it reads "that day", not "today"; the heartbeat, when it is on that day,
// names its date. Empty, or offline with nothing known, reads "—".
export function codingText(
  { language: name, today, at }: Coding,
  { dataset: { zone } }: { dataset: DOMStringMap },
) {
  if (!today) {
    return { today: '—', language: '', time: '' };
  }
  return {
    today: `${today} that day`,
    // The separator is text, not a ::before, which Chrome counts as a shift when the time changes.
    language: name ? ` · top language ${name}` : '',
    time: at ? `last heartbeat ${heartbeat(at, zone)}` : '',
  };
}

// "4 Nov, 22:45": 'en' parts, because Node's en-GB writes "Sept", in the clock's 24-hour form.
function heartbeat(at: string, zone?: string) {
  const part = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: zone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(Date.parse(at))
      .map(({ type, value }) => [type, value]),
  );
  return `${part.day} ${part.month}, ${part.hour}:${part.minute}`;
}

// One share of the 30-day language mix, in whole percent; 'other' gathers the rest.
export interface Share {
  name: string;
  percent: number;
}

// Maps ready last_30_days stats into shares that sum to 100; incomplete stats retry on the next
// poll. Only the top five known languages are named; the rest join 'other' to keep the card
// compact.
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
