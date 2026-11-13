import site from './site.json';

// The public profile's GitHub contribution count for each UTC day, oldest first, ending on `end`,
// the UTC day the value was made. The window starts on the Sunday 52 weeks before the Sunday of
// `end`'s week, so `days` holds 365 to 371 counts. Levels and the total are derived from the
// counts. Shared by the build, the Function and the browser, so the top level holds only literals,
// types and functions: nothing here runs on import.
export interface Contributions {
  end: string;
  days: number[];
}

export const graphql = 'https://api.github.com/graphql';

// Two ranges of one calendar, since GitHub refuses a range longer than a year: the window's first
// week, then the rest. Only each day's date and count are asked for, never a repository.
const contributionsQuery = `query ($login: String!, $a: DateTime!, $b: DateTime!, $c: DateTime!, $d: DateTime!) {
  user(login: $login) {
    head: contributionsCollection(from: $a, to: $b) { ...days }
    tail: contributionsCollection(from: $c, to: $d) { ...days }
  }
}
fragment days on ContributionsCollection {
  contributionCalendar { weeks { contributionDays { date contributionCount } } }
}`;

const day = 86_400_000;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The window ending on `now`'s UTC day, in UTC milliseconds over whole days, so no local time or
// daylight saving enters.
export function span(now: number) {
  const last = Math.floor(now / day) * day;
  const length = 365 + new Date(last).getUTCDay();
  return { start: date(last - (length - 1) * day), end: date(last), length };
}

// The fetch init for `now`'s window. The login is the profile site.json links to, never the
// token's own account, so a token made on another account cannot show another person's graph.
export function contributionsRequest(token: string, now: number, signal: AbortSignal) {
  const first = Date.parse(span(now).start);
  // GitHub's DateTime, without milliseconds.
  const at = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // GitHub rejects an API request without one.
      'User-Agent': 'vedaantrajoo.com',
    },
    body: JSON.stringify({
      query: contributionsQuery,
      variables: {
        login: new URL(site.socials.github).pathname.split('/')[1],
        a: at(first),
        b: at(first + 7 * day - 1000),
        c: at(first + 7 * day),
        d: at(now),
      },
    }),
    signal,
  };
}

// Why a body with GraphQL errors gives no value: GitHub's error type when it is one upper-case
// word, such as RATE_LIMITED, never the message; undefined when the body has no errors.
export function graphqlError(body: unknown): string | undefined {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return undefined;
  }
  const type = (errors[0] as { type?: unknown } | null)?.type;
  return `GraphQL ${typeof type === 'string' && /^[A-Z_]{1,40}$/.test(type) ? type : 'errors'}`;
}

// One range's days, flattened from its weeks; null when the range is not a calendar.
function calendarDays(range: unknown): unknown[] | null {
  const weeks = (range as { contributionCalendar?: { weeks?: unknown } } | null)
    ?.contributionCalendar?.weeks;
  if (!Array.isArray(weeks)) {
    return null;
  }
  const lists = weeks.map(
    (week) => (week as { contributionDays?: unknown } | null)?.contributionDays,
  );
  return lists.every(Array.isArray) ? lists.flat() : null;
}

// A day's date, in UTC milliseconds, and its count; null when either is malformed. The date must
// read back as the same YYYY-MM-DD, which also refuses 2025-02-30, a day in March to some engines.
function toDay(entry: unknown): [number, number] | null {
  const { date: when, contributionCount: count } = (entry ?? {}) as Record<string, unknown>;
  const ms = typeof when === 'string' ? Date.parse(when) : Number.NaN;
  return !Number.isNaN(ms) && date(ms) === when && Number.isSafeInteger(count) && Number(count) >= 0
    ? [ms, Number(count)]
    : null;
}

// Maps a parsed GitHub answer to `now`'s window. Days outside the window are dropped; null when the
// body has GraphQL errors, is not a calendar, or has a malformed day, or a window day missing or
// repeated across the two ranges.
export function toContributions(body: unknown, now: number): Contributions | null {
  const { data, errors } = (body ?? {}) as { data?: { user?: unknown } | null; errors?: unknown };
  const user = data?.user as { head?: unknown; tail?: unknown } | null | undefined;
  const head = calendarDays(user?.head);
  const tail = calendarDays(user?.tail);
  if ((Array.isArray(errors) ? errors.length > 0 : errors !== undefined) || !head || !tail) {
    return null;
  }
  const { start, end, length } = span(now);
  const first = Date.parse(start);
  // -1 marks a day not seen yet.
  const days = Array<number>(length).fill(-1);
  for (const entry of [...head, ...tail]) {
    const parsed = toDay(entry);
    if (!parsed) {
      return null;
    }
    const index = (parsed[0] - first) / day;
    if (index >= 0 && index < length) {
      if (days[index] !== -1) {
        return null;
      }
      days[index] = parsed[1];
    }
  }
  return days.includes(-1) ? null : { end, days };
}

// "4 Nov 2026", from toUTCString's fixed form ("Wed, 04 Nov 2026 …"), so the browser needs neither
// a month table nor Intl.
const dayText = (ms: number) => new Date(ms).toUTCString().slice(5, 16).replace(/^0/, '');
const counted = (count: number) =>
  `${count.toLocaleString('en')} contribution${count === 1 ? '' : 's'}`;
// The window's first day, a Sunday, in UTC milliseconds.
const firstDay = ({ end, days }: Contributions) => Date.parse(end) - (days.length - 1) * day;

// A day's level, 0 to 4, as the profile's own calendar draws it: each a quarter of the window's
// busiest day, taking the next level up, so any contribution is at least 1.
export const level = (count: number, max: number) => (count ? Math.ceil((4 * count) / max) : 0);

// The heatmap's 371 slots, 53 week columns of 7 days from the window's first Sunday, column by
// column: each day's level and title, null after end.
export function cells(value: Contributions) {
  const start = firstDay(value);
  const max = Math.max(...value.days);
  return Array.from({ length: 371 }, (_, i) => {
    const count = value.days[i];
    return count === undefined
      ? null
      : {
          level: level(count, max),
          title: `${count ? counted(count) : 'no contributions'} on ${dayText(start + i * day)}`,
        };
  });
}

// The cell's texts: the window's total, or "no public activity", since its first day, and the day
// the value was made, with its ISO date for the <time>.
export function contributionsText(value: Contributions) {
  const total = value.days.reduce((sum, count) => sum + count, 0);
  return {
    total: total ? counted(total) : 'no public activity',
    since: `since ${dayText(firstDay(value))}`,
    updated: `updated ${dayText(Date.parse(value.end))}`,
    date: value.end,
  };
}

// Checks the contributions value of a parsed /api/activity body in the form the Function writes: a
// real day `end` and one non-negative safe integer per day of its window; null for anything else.
// `end` is checked to be a string before anything reads it, so no value can throw here and cost
// the answer's other parts.
export function contributionsFromLive(body: unknown): Contributions | null {
  const { end, days } = Object(Object(body).contributions);
  const ms = typeof end === 'string' ? Date.parse(end) : Number.NaN;
  return !Number.isNaN(ms) &&
    date(ms) === end &&
    Array.isArray(days) &&
    days.length === 365 + new Date(ms).getUTCDay() &&
    days.every((count) => Number.isSafeInteger(count) && count >= 0)
    ? { end, days }
    : null;
}
