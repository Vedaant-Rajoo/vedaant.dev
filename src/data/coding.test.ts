import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Coding, codingFromLive, codingText, duration, toCoding } from './coding';
import snapshot from './snapshots/wakatime.json';

const now = Date.parse('2026-10-31T12:00:30Z');
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

test('maps today and the last heartbeat: live within 15 minutes, idle after', () => {
  assert.deepEqual(toCoding(bar(4860), user('2026-10-31T11:50:45Z'), now), {
    state: 'live',
    language: 'TypeScript',
    today: '1h 21m',
    at: '2026-10-31T11:50:00.000Z',
  });
  assert.equal(toCoding(bar(4860), user('2026-10-31T11:45:00Z'), now)?.state, 'idle');
  assert.equal(toCoding(bar(4860), user('2026-10-31T09:00:00Z'), now)?.state, 'idle');
});

test('passes on the top language only, never a project, branch or editor', () => {
  const value = toCoding(bar(4860), user('2026-10-31T11:50:45Z'), now);
  assert.deepEqual(Object.keys(value ?? {}), ['state', 'language', 'today', 'at']);
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
    assert.equal(toCoding(bar(4860, languages), user('2026-10-31T11:50:45Z'), now)?.language, null);
  }
});

test('a day under a minute is empty, and a body that is not WakaTime is null', () => {
  const empty = { state: 'empty', language: null, today: null, at: null };
  assert.deepEqual(toCoding(bar(0), user('2026-10-30T23:00:00Z'), now), empty);
  assert.deepEqual(toCoding(bar(59), user(null), now), empty);
  // An empty day still needs a users/current body; a malformed one is a failure, not "empty".
  for (const body of [null, {}, { data: {} }, user(42)]) {
    assert.equal(toCoding(bar(0), body, now), null, JSON.stringify(body));
  }
  // An invalid heartbeat, or a total that is no finite number, is a failure too.
  assert.equal(toCoding(bar(0), user('not a time'), now), null);
  assert.equal(toCoding(bar(Number.POSITIVE_INFINITY), user('2026-10-31T11:50:45Z'), now), null);
  assert.equal(toCoding(bar(Number.NaN), user('2026-10-31T11:50:45Z'), now), null);
  for (const [a, b] of [
    [null, user('2026-10-31T11:50:45Z')],
    [{ data: {} }, user('2026-10-31T11:50:45Z')],
    [bar(-1), user('2026-10-31T11:50:45Z')],
    [bar(4860, 'TypeScript'), user('2026-10-31T11:50:45Z')],
    [bar(4860), user('yesterday')],
    [bar(4860), null],
  ]) {
    assert.equal(toCoding(a, b, now), null);
  }
});

test('duration reads hours and minutes', () => {
  assert.equal(duration(0), '0m');
  assert.equal(duration(2700), '45m');
  assert.equal(duration(7800), '2h 10m');
  assert.equal(duration(36000), '10h 0m');
});

test('the committed snapshot is a value the hub accepts', () => {
  assert.deepEqual(codingFromLive(snapshot), snapshot as Coding);
});

test('codingFromLive keeps only the shape the Function writes', () => {
  const live: Coding = {
    state: 'live',
    language: 'C++',
    today: '2h 10m',
    at: '2026-10-31T11:50:00.000Z',
  };
  assert.deepEqual(codingFromLive(live), live);
  assert.deepEqual(
    codingFromLive({ ...live, state: 'empty', language: null, today: null, at: null }),
    {
      state: 'empty',
      language: null,
      today: null,
      at: null,
    },
  );
  for (const bad of [
    null,
    'live',
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
  ]) {
    assert.equal(codingFromLive(bad), null, JSON.stringify(bad));
  }
  // Extra fields are dropped, so nothing else reaches the page.
  assert.deepEqual(codingFromLive({ ...live, project: 'secret' }), live);
});

test('codingText: live says now, idle the age, empty and unknown a dash', () => {
  const value: Coding = {
    state: 'idle',
    language: 'TypeScript',
    today: '1h 20m',
    at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  };
  assert.deepEqual(codingText('live', value), {
    language: 'TypeScript',
    today: '1h 20m today',
    time: 'now',
  });
  assert.deepEqual(codingText('idle', value), {
    language: 'TypeScript',
    today: '1h 20m today',
    time: '3h ago',
  });
  assert.deepEqual(codingText('idle', { ...value, language: null }).language, 'coding');
  assert.deepEqual(codingText('empty', { state: 'empty', language: null, today: null, at: null }), {
    language: '—',
    today: '',
    time: '',
  });
});
