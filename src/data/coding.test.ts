import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Coding,
  codingFromLive,
  codingText,
  duration,
  tag,
  tags,
  toCoding,
  toShares,
} from './coding';
import snapshot from './snapshots/wakatime.json';

// A day of WakaTime's summaries and users/current, as WakaTime answers them, trimmed to what
// toCoding reads plus the project, branch and editor names it must never pass on. Days are
// Asia/Kolkata days, as the source asks for them: 2026-11-10 runs from 2026-11-09T18:30:00Z to
// 2026-11-10T18:29:59Z.
const day = (
  date: string,
  seconds: number,
  languages: unknown = [
    { name: 'Markdown', total_seconds: 600 },
    { name: 'TypeScript', total_seconds: 4200 },
  ],
) => {
  const start = Date.parse(`${date}T00:00:00+05:30`);
  const second = (time: number) => new Date(time).toISOString().replace('.000', '');
  return {
    grand_total: { total_seconds: seconds, text: '1 hr 20 mins' },
    languages,
    projects: [{ name: 'secret-client-work' }],
    editors: [{ name: 'Zed' }],
    range: {
      date,
      start: second(start),
      end: second(start + 86_399_000),
      text: 'Tue Nov 10th 2026',
      timezone: 'Asia/Kolkata',
    },
  };
};
// The last seven days, oldest first, as WakaTime orders them.
const week = (...days: unknown[]) => ({ data: days, cumulative_total: { seconds: 1 } });
const user = (heartbeat: unknown) => ({
  data: { last_heartbeat_at: heartbeat, last_project: 'secret-client-work', last_branch: 'main' },
});
const stats = { data: { languages: [], range: 'last_30_days', is_up_to_date: true } };
const empty = { state: 'empty', language: null, today: null, at: null, shares: [] };

test('maps the day and its last heartbeat, idle however recent: a heartbeat is never presence', () => {
  const recent = new Date(Date.now() - 30_000).toISOString();
  assert.deepEqual(
    toCoding(
      week(day('2026-10-30', 0), day('2026-10-31', 4860)),
      user('2026-10-31T11:50:45Z'),
      stats,
    ),
    {
      state: 'idle',
      language: 'TypeScript',
      today: '1h 21m',
      at: '2026-10-31T11:50:00.000Z',
      shares: [],
    },
  );
  assert.equal(toCoding(week(day('2026-10-31', 4860)), user(recent), stats)?.state, 'idle');
});

test('passes on the top language only, never a project, branch or editor', () => {
  const value = toCoding(week(day('2026-10-31', 4860)), user('2026-10-31T11:50:45Z'), stats);
  assert.deepEqual(Object.keys(value ?? {}), ['state', 'language', 'today', 'at', 'shares']);
  assert.doesNotMatch(JSON.stringify(value), /secret|main|Zed|Markdown|Kolkata|Nov/);
  // "Other", a name with markup, or none at all, is no language.
  for (const languages of [
    [{ name: 'Other', total_seconds: 9 }],
    [{ name: '<b>x</b>', total_seconds: 9 }],
    // A plugin can report anything as a language: a project, a branch, a file or an editor.
    [{ name: 'secret-client-work', total_seconds: 9 }],
    [{ name: 'main', total_seconds: 9 }],
    [{ name: 'package.json', total_seconds: 9 }],
    [{ name: 'Zed', total_seconds: 9 }],
    [],
  ]) {
    assert.equal(
      toCoding(week(day('2026-10-31', 4860, languages)), user('2026-10-31T11:50:45Z'), stats)
        ?.language,
      null,
    );
  }
});

test('a day without a minute yet shows the newest earlier day that has one, with its language', () => {
  const go = [
    { name: 'TypeScript', total_seconds: 1200 },
    { name: 'Go', total_seconds: 6600 },
  ];
  const days = [
    day('2026-11-05', 3000),
    day('2026-11-06', 7800, go),
    day('2026-11-07', 0),
    // Under a minute is no day to show, however recent.
    day('2026-11-08', 59),
    day('2026-11-09', 0),
    day('2026-11-10', 59.9),
    day('2026-11-11', 0),
  ];
  // 23:40 on 6 November in Kolkata.
  const value = toCoding(week(...days), user('2026-11-06T18:10:30Z'), stats);
  assert.deepEqual(value, {
    state: 'idle',
    language: 'Go',
    today: '2h 10m',
    at: '2026-11-06T18:10:00.000Z',
    shares: [],
  });
  assert.deepEqual(codingText(value as Coding, { dataset: { zone: 'Asia/Kolkata' } }), {
    today: '2h 10m that day',
    language: 'top language Go',
    time: 'last heartbeat 6 Nov, 23:40',
  });
  // The newest day wins whatever the order, and a minute is enough.
  const reversed = [...days].reverse();
  assert.equal(toCoding(week(...reversed), user('2026-11-06T18:10:30Z'), stats)?.today, '2h 10m');
  assert.equal(
    toCoding(week(...days, day('2026-11-12', 60)), user('2026-11-12T10:00:00Z'), stats)?.today,
    '1m',
  );
});

test('a week with no day of a minute is empty', () => {
  const days = ['05', '06', '07', '08', '09', '10', '11'].map((d, i) =>
    day(`2026-11-${d}`, [0, 59, 0, 30, 0, 0, 12][i]),
  );
  assert.deepEqual(toCoding(week(...days), user('2026-11-11T05:11:04Z'), stats), empty);
  assert.deepEqual(toCoding(week(...days), user(null), stats), empty);
  assert.deepEqual(codingText(empty as Coding, { dataset: { zone: 'Asia/Kolkata' } }), {
    today: '—',
    language: '',
    time: '',
  });
});

test("the heartbeat shows only when it is on the day shown, never a later day's", () => {
  const days = week(day('2026-11-10', 7200), day('2026-11-11', 20));
  const cell = { dataset: { zone: 'Asia/Kolkata' } };
  const at = (heartbeat: string) => toCoding(days, user(heartbeat), stats)?.at;
  // A few seconds at 00:15 on 11 November in Kolkata, after two hours on the 10th: the cell keeps
  // the 10th's time and language and names no heartbeat, rather than the 11th's.
  const later = toCoding(days, user('2026-11-10T18:45:10Z'), stats);
  assert.equal(later?.at, null);
  assert.equal(later?.today, '2h 0m');
  assert.deepEqual(codingText(later as Coding, cell), {
    today: '2h 0m that day',
    language: 'top language TypeScript',
    time: '',
  });
  // The hub takes an idle value without a heartbeat as it is.
  assert.deepEqual(codingFromLive({ coding: later }), later);
  // The day's first and last seconds are on it, in Kolkata.
  assert.equal(at('2026-11-09T18:30:00Z'), '2026-11-09T18:30:00.000Z');
  assert.equal(at('2026-11-10T18:29:59Z'), '2026-11-10T18:29:00.000Z');
  assert.equal(
    codingText({ ...(later as Coding), at: at('2026-11-10T18:29:59Z') ?? null }, cell).time,
    'last heartbeat 10 Nov, 23:59',
  );
  assert.equal(at('2026-11-10T18:30:00Z'), null);
  // One before the day, which WakaTime should never answer, is not paired either.
  assert.equal(at('2026-11-09T18:29:59Z'), null);
  // A day of 23 or 25 hours, across a clock change, is still a day: Los Angeles on 8 March and
  // 1 November 2026.
  for (const [start, end] of [
    ['2026-03-08T08:00:00Z', '2026-03-09T06:59:59Z'],
    ['2026-11-01T07:00:00Z', '2026-11-02T07:59:59Z'],
  ]) {
    const dst = { ...day('2026-11-10', 7200), range: { start, end } };
    assert.equal(toCoding(week(dst), user(start), stats)?.at, `${start.slice(0, 16)}:00.000Z`);
  }
});

test('a malformed week, users/current or stats body is null, never empty', () => {
  const good = day('2026-11-10', 4860);
  const heartbeat = user('2026-11-10T11:50:45Z');
  for (const body of [
    null,
    {},
    { data: {} },
    { data: 'week' },
    // "Last 7 Days" always has seven days, so none is a broken answer.
    week(),
    // One malformed day fails the week, however old.
    week(null, good),
    week({}, good),
    week({ ...good, grand_total: {} }, good),
    week({ ...good, grand_total: { total_seconds: -1 } }, good),
    week({ ...good, grand_total: { total_seconds: Number.NaN } }, good),
    week({ ...good, grand_total: { total_seconds: Number.POSITIVE_INFINITY } }, good),
    week({ ...good, grand_total: { total_seconds: '4860' } }, good),
    week({ ...good, languages: 'TypeScript' }, good),
    week({ ...good, range: undefined }, good),
    week({ ...good, range: { ...good.range, start: 'yesterday' } }, good),
    week({ ...good, range: { ...good.range, end: null } }, good),
    week({ ...good, range: { ...good.range, end: good.range.start } }, good),
    // A range of two days, or of half of one, is no day: it could hold another day's heartbeat.
    week({ ...good, range: { ...good.range, end: day('2026-11-11', 0).range.end } }, good),
    week({ ...good, range: { ...good.range, end: '2026-11-10T06:29:59Z' } }, good),
  ]) {
    assert.equal(toCoding(body, heartbeat, stats), null, JSON.stringify(body));
  }
  // An empty week still needs a users/current body; a malformed one is a failure, not "empty".
  for (const body of [null, {}, { data: {} }, user(42), user('not a time')]) {
    assert.equal(toCoding(week(day('2026-11-10', 0)), body, stats), null, JSON.stringify(body));
  }
  // A day with coding needs a heartbeat.
  assert.equal(toCoding(week(good), user(null), stats), null);
  assert.equal(toCoding(week(good), user('yesterday'), stats), null);
  assert.equal(toCoding(week(good), heartbeat, { data: {} }), null);
});

test('duration reads hours and minutes', () => {
  assert.equal(duration(0), '0m');
  assert.equal(duration(2700), '45m');
  assert.equal(duration(7800), '2h 10m');
  assert.equal(duration(36000), '10h 0m');
});

test('the committed snapshot is a value the hub accepts', () => {
  assert.deepEqual(codingFromLive({ coding: snapshot }), snapshot as Coding);
});

test('codingFromLive keeps only the shape the Function writes', () => {
  const live: Coding = {
    state: 'idle',
    language: 'C++',
    today: '2h 10m',
    at: '2026-10-31T11:50:00.000Z',
    shares: [{ name: 'C++', percent: 100 }],
  };
  assert.deepEqual(codingFromLive({ coding: live }), live);
  assert.deepEqual(
    codingFromLive({ coding: { ...live, state: 'empty', language: null, today: null, at: null } }),
    {
      state: 'empty',
      language: null,
      today: null,
      at: null,
      shares: live.shares,
    },
  );
  for (const bad of [
    null,
    'live',
    // Coding has no live state, so an answer that claims one is not the Function's.
    { ...live, state: 'live' },
    { ...live, state: 'offline' },
    { ...live, language: '<img>' },
    { ...live, language: 'Other' },
    { ...live, language: 'secret-client-work' },
    { ...live, today: '2 hrs' },
    { ...live, today: 130 },
    { ...live, today: null },
    { state: 'empty', language: null, today: '5m', at: null },
    { ...live, at: '2026-10-31T11:50:30.000Z' },
    { ...live, at: 'now' },
    { ...live, shares: undefined },
    { ...live, shares: null },
    { ...live, shares: [null] },
    { ...live, shares: [{ name: 'secret', percent: 100 }] },
    { ...live, shares: [{ name: 'Go', percent: 99 }] },
    { ...live, shares: [{ name: 'Go', percent: -1 }] },
    {
      ...live,
      shares: [
        { name: 'Go', percent: 99.5 },
        { name: 'other', percent: 0.5 },
      ],
    },
    {
      ...live,
      shares: [
        { name: 'Go', percent: 50 },
        { name: 'Go', percent: 50 },
      ],
    },
    {
      ...live,
      shares: [
        { name: 'other', percent: 50 },
        { name: 'Go', percent: 50 },
      ],
    },
    {
      ...live,
      shares: ['Go', 'Rust', 'Astro', 'CSS', 'Shell', 'Lua'].map((name) => ({
        name,
        percent: name === 'Go' ? 50 : 10,
      })),
    },
  ]) {
    assert.equal(codingFromLive({ coding: bad }), null, JSON.stringify(bad));
  }
  // An /api/activity body without a coding value, as when WakaTime failed, is no value either.
  for (const body of [null, 'x', [], {}, { reading: null }, live]) {
    assert.equal(codingFromLive(body), null, JSON.stringify(body));
  }
  // Extra fields are dropped, so nothing else reaches the page.
  assert.deepEqual(codingFromLive({ coding: { ...live, project: 'secret' } }), live);
  assert.deepEqual(
    codingFromLive({
      coding: { ...live, shares: [{ name: 'C++', percent: 100, project: 'secret' }] },
    }),
    live,
  );
});

test('codingText: the heartbeat date and minute, in the clock zone, stay true for a daily snapshot', () => {
  const value: Coding = {
    state: 'idle',
    language: 'TypeScript',
    today: '1h 20m',
    at: '2026-11-01T11:55:00.000Z',
    shares: [],
  };
  // In the owner's zone, as the clock shows it, the UTC day before rolling over into the next.
  const cell = { dataset: { zone: 'Asia/Kolkata' } };
  assert.deepEqual(codingText(value, cell), {
    today: '1h 20m that day',
    language: 'top language TypeScript',
    time: 'last heartbeat 1 Nov, 17:25',
  });
  assert.equal(
    codingText({ ...value, at: '2026-10-31T23:59:00.000Z' }, cell).time,
    'last heartbeat 1 Nov, 05:29',
  );
  assert.equal(
    codingText({ ...value, at: '2026-09-04T18:30:00.000Z' }, cell).time,
    'last heartbeat 5 Sep, 00:00',
  );
  assert.equal(
    codingText({ ...value, at: '2026-09-04T18:30:00.000Z' }, { dataset: { zone: 'UTC' } }).time,
    'last heartbeat 4 Sep, 18:30',
  );
  assert.equal(codingText({ ...value, language: null }, cell).language, '');
  assert.equal(codingText({ ...value, at: null }, cell).time, '');
  assert.deepEqual(
    codingText({ state: 'empty', language: null, today: null, at: null, shares: [] }, cell),
    {
      today: '—',
      language: '',
      time: '',
    },
  );
});

test('toShares: whole percents summing to 100, top five known languages, remaining names other', () => {
  const body = (languages: unknown) => ({
    data: { languages, range: 'last_30_days', is_up_to_date: true },
  });
  assert.deepEqual(
    toShares(
      body([
        { name: 'TypeScript', percent: 50.4, color: 'unused' },
        { name: 'Astro', percent: 20.3 },
        { name: 'CSS', percent: 12.2 },
        { name: 'Rust', percent: 8.6 },
        // A plugin can report a project or file as a language: it joins other, unnamed.
        { name: 'secret-client-work', percent: 5.5 },
        { name: 'Other', percent: 3 },
      ]),
    ),
    [
      { name: 'TypeScript', percent: 50 },
      { name: 'Astro', percent: 20 },
      { name: 'CSS', percent: 12 },
      { name: 'Rust', percent: 9 },
      { name: 'other', percent: 9 },
    ],
  );
  // Percents that do not sum to 100 are scaled; a share rounding to 0 is left out.
  assert.deepEqual(
    toShares(
      body([
        { name: 'Go', percent: 1 },
        { name: 'Zig', percent: 1 },
        { name: 'Lua', percent: 1 },
      ]),
    ),
    [
      { name: 'Go', percent: 34 },
      { name: 'Lua', percent: 33 },
      { name: 'Zig', percent: 33 },
    ],
  );
  assert.deepEqual(
    toShares(
      body([
        { name: 'Go', percent: 99.9 },
        { name: 'Zig', percent: 0.1 },
      ]),
    ),
    [{ name: 'Go', percent: 100 }],
  );
  // Nothing tracked is an empty mix; a body that is not the chart's is null.
  assert.deepEqual(toShares(body([])), []);
  assert.deepEqual(toShares(body([{ name: 'Go', percent: 0 }])), []);
  for (const bad of [
    null,
    {},
    { data: { languages: [], range: 'last_7_days', is_up_to_date: true } },
    { data: { languages: [], range: 'last_30_days', is_up_to_date: false } },
    body('Go'),
    body([{ name: 'Go' }]),
    body([{ name: 'Go', percent: -1 }]),
    body([{ name: 'Go', percent: 101 }]),
    body([{ name: 'Go', percent: Number.POSITIVE_INFINITY }]),
    body([{ name: 'Go', percent: '50' }]),
    body([{ percent: 50 }]),
    body([
      { name: 'Go', percent: Number.MAX_VALUE },
      { name: 'Zig', percent: Number.MAX_VALUE },
    ]),
  ]) {
    assert.equal(toShares(bad), null, JSON.stringify(bad));
  }
  assert.doesNotMatch(JSON.stringify(toShares(body([{ name: 'secret', percent: 9 }]))), /secret/);
});

test('toShares ranks all languages before grouping those below fifth with unknown names', () => {
  assert.deepEqual(
    toShares({
      data: {
        range: 'last_30_days',
        is_up_to_date: true,
        languages: [
          { name: 'Go', percent: 2 },
          { name: 'Shell', percent: 8 },
          { name: 'secret-client-work', percent: 1 },
          { name: 'Astro', percent: 20 },
          { name: 'JavaScript', percent: 4 },
          { name: 'Rust', percent: 10 },
          { name: 'CSS', percent: 15 },
          { name: 'TypeScript', percent: 40 },
        ],
      },
    }),
    [
      { name: 'TypeScript', percent: 40 },
      { name: 'Astro', percent: 20 },
      { name: 'CSS', percent: 15 },
      { name: 'Rust', percent: 10 },
      { name: 'Shell', percent: 8 },
      { name: 'other', percent: 7 },
    ],
  );
});

test('tag: a text glyph for every named language, an ellipsis for other', () => {
  assert.equal(tag(tags, 'TypeScript'), '.ts');
  assert.equal(tag(tags, 'C#'), '.cs');
  assert.equal(tag(tags, 'Go'), '.go');
  assert.equal(tag(tags, 'GraphQL'), '.graphql');
  assert.equal(tag(tags, 'Makefile'), 'Makefile');
  assert.equal(tag(tags, 'other'), '…');
});
