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

// status_bar/today and users/current, as WakaTime answers them, trimmed to what toCoding reads plus
// the project and editor names it must never pass on.
const bar = (
  seconds: number,
  languages: unknown = [
    { name: 'Markdown', total_seconds: 600 },
    { name: 'TypeScript', total_seconds: 4200 },
  ],
) => ({
  data: {
    grand_total: { total_seconds: seconds, text: '1 hr 20 mins' },
    languages,
    projects: [{ name: 'secret-client-work' }],
    editors: [{ name: 'Zed' }],
  },
});
const user = (heartbeat: unknown) => ({
  data: { last_heartbeat_at: heartbeat, last_project: 'secret-client-work', last_branch: 'main' },
});
const stats = { data: { languages: [], range: 'last_30_days', is_up_to_date: true } };

test('maps today and the last heartbeat, idle however recent: a heartbeat is never presence', () => {
  const recent = new Date(Date.now() - 30_000).toISOString();
  assert.deepEqual(toCoding(bar(4860), user('2026-10-31T11:50:45Z'), stats), {
    state: 'idle',
    language: 'TypeScript',
    today: '1h 21m',
    at: '2026-10-31T11:50:00.000Z',
    shares: [],
  });
  assert.equal(toCoding(bar(4860), user(recent), stats)?.state, 'idle');
});

test('passes on the top language only, never a project, branch or editor', () => {
  const value = toCoding(bar(4860), user('2026-10-31T11:50:45Z'), stats);
  assert.deepEqual(Object.keys(value ?? {}), ['state', 'language', 'today', 'at', 'shares']);
  assert.doesNotMatch(JSON.stringify(value), /secret|main|Zed|Markdown/);
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
      toCoding(bar(4860, languages), user('2026-10-31T11:50:45Z'), stats)?.language,
      null,
    );
  }
});

test('a day under a minute is empty, and a body that is not WakaTime is null', () => {
  const empty = { state: 'empty', language: null, today: null, at: null, shares: [] };
  assert.deepEqual(toCoding(bar(0), user('2026-10-30T23:00:00Z'), stats), empty);
  assert.deepEqual(toCoding(bar(59), user(null), stats), empty);
  // An empty day still needs a users/current body; a malformed one is a failure, not "empty".
  for (const body of [null, {}, { data: {} }, user(42)]) {
    assert.equal(toCoding(bar(0), body, stats), null, JSON.stringify(body));
  }
  // An invalid heartbeat, or a total that is no finite number, is a failure too.
  assert.equal(toCoding(bar(0), user('not a time'), stats), null);
  assert.equal(toCoding(bar(Number.POSITIVE_INFINITY), user('2026-10-31T11:50:45Z'), stats), null);
  assert.equal(toCoding(bar(Number.NaN), user('2026-10-31T11:50:45Z'), stats), null);
  for (const [a, b] of [
    [null, user('2026-10-31T11:50:45Z')],
    [{ data: {} }, user('2026-10-31T11:50:45Z')],
    [bar(-1), user('2026-10-31T11:50:45Z')],
    [bar(4860, 'TypeScript'), user('2026-10-31T11:50:45Z')],
    [bar(4860), user('yesterday')],
    [bar(4860), null],
  ]) {
    assert.equal(toCoding(a, b, stats), null);
  }
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
