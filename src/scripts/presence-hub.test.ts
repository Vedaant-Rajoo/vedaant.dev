import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { codingFromLive, codingText } from '../data/coding';
import { shelfFromLive, shelfText } from '../data/shelf-live';
import type { Hub } from './presence-hub';

// Just enough of a page for the hub: widgets with text holders, one visibility listener, and
// timers the test runs by hand while it moves Date.now. The browser's HTTP cache is not modelled;
// each poll is one fetch here.
const real = { setTimeout, clearTimeout, fetch: globalThis.fetch, now: Date.now };
const events = { addEventListener, removeEventListener };
const start = Date.parse('2026-11-01T12:00:00Z');
let now = start;
let timers = new Map<number, { run: () => void; delay: number }>();
let next = 0;
let listeners = new Set<() => void>();
let widgets: Widget[] = [];
let requests: string[] = [];
let answers: (() => Response | Promise<Response>)[] = [];
const page = {
  hidden: false,
  querySelectorAll: (selector: string) => (selector.startsWith('[data-widget]') ? widgets : []),
};

class Element {
  attributes = new Map<string, string>();
  textContent = 'build';
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
}
class Time extends Element {}
class Widget extends Element {
  holders: Record<string, Element>;
  constructor(
    readonly dataset: Record<string, string>,
    names: string[],
  ) {
    super();
    this.holders = Object.fromEntries(
      names.map((name) => [name, name === 'meta' || name === 'time' ? new Time() : new Element()]),
    );
  }
  querySelector(selector: string) {
    return this.holders[/="([^"]+)"/.exec(selector)?.[1] ?? ''] ?? null;
  }
}

let hub: Hub & { connectedCallback(): void; disconnectedCallback(): void };
Object.assign(globalThis, {
  HTMLElement: class {
    ownerDocument = page;
  },
  HTMLTimeElement: Time,
  document: page,
  customElements: {
    define: (_: string, element: new () => typeof hub) => {
      hub = new element();
    },
  },
  addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
});
let copies = 0;

// Runs the one timer set, as the browser would after its delay, and lets the poll finish.
async function elapse() {
  assert.equal(timers.size, 1, `${timers.size} timers set`);
  const [[id, { run, delay }]] = timers;
  timers.delete(id);
  now += delay;
  run();
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => real.setTimeout(resolve, 0));
  }
  return delay;
}
const delay = () => [...timers.values()][0]?.delay;

const rows = { reading: '', lastWatched: '', listening: '' };
const body = (titles = rows) => ({
  coding: {
    state: 'idle',
    language: 'Go',
    today: '2h 10m',
    at: '2026-11-01T11:00:00.000Z',
    shares: [],
  },
  reading: { title: `Dune${titles.reading}`, creator: 'Frank Herbert' },
  lastWatched: { title: `Clueless${titles.lastWatched}`, year: 1995, date: '2026-10-28' },
  listening: { title: `STAY ALIVE${titles.listening}`, creator: 'JUNGKOOK', plays: 7 },
});
// An answer as /api/activity gives it: made `age` seconds ago, kept `seconds`.
const answer =
  (value: unknown, seconds = 86_400, age = 0) =>
  () =>
    Response.json(value, {
      headers: {
        'cache-control': `public, max-age=${seconds}, s-maxage=${seconds}`,
        date: new Date(now - age * 1000).toUTCString(),
        expires: new Date(now + (seconds - age) * 1000).toUTCString(),
      },
    });

beforeEach(async () => {
  // A fresh copy of the module each test, so no feed carries over.
  await import(`./presence-hub.ts?${++copies}`);
  now = start;
  Date.now = () => now;
  timers = new Map();
  listeners = new Set();
  requests = [];
  answers = [];
  page.hidden = false;
  globalThis.setTimeout = ((run: () => void, ms: number) => {
    timers.set(++next, { run, delay: ms });
    return next;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as typeof clearTimeout;
  globalThis.fetch = (async (path: string) => {
    requests.push(path);
    const respond = answers.shift();
    assert.ok(respond, `no answer for ${path}`);
    return respond();
  }) as typeof fetch;
});

after(() => {
  for (const name of ['HTMLElement', 'HTMLTimeElement', 'document', 'customElements']) {
    Reflect.deleteProperty(globalThis, name);
  }
  Object.assign(globalThis, events);
});

afterEach(() => {
  hub.disconnectedCallback();
  Object.assign(globalThis, real);
  Date.now = real.now;
});

const shelfRows = () => [
  new Widget({ widget: 'reading' }, ['tile', 'title', 'sub', 'meta']),
  new Widget({ widget: 'last-watched' }, ['tile', 'title', 'sub', 'stars', 'rated', 'meta']),
  new Widget({ widget: 'on-repeat' }, ['tile', 'title', 'sub', 'meta']),
];
const titles = () => widgets.map((widget) => widget.holders.title.textContent);

test('/shelf: one /api/activity request for three rows, then not again for a day', async () => {
  widgets = shelfRows();
  hub.connectedCallback();
  hub.add('/api/activity', ['reading', 'last-watched', 'on-repeat'], shelfFromLive, shelfText);
  answers.push(answer(body()));
  assert.equal(await elapse(), 0);
  assert.deepEqual(requests, ['/api/activity']);
  assert.deepEqual(titles(), [
    'reading · Dune',
    'last watched · \u2068Clueless\u2069 (1995)',
    'on repeat · STAY ALIVE',
  ]);
  assert.equal(widgets[1].holders.meta.getAttribute('datetime'), '2026-10-28');
  // One timer, a day long: no hourly polls in between.
  answers.push(answer(body({ ...rows, listening: ' 2' })));
  assert.equal(await elapse(), 86_400_000);
  assert.equal(requests.length, 2);
  assert.equal(titles()[2], 'on repeat · STAY ALIVE 2');
});

test('a partial answer updates the rows it has, keeps the others, and is asked for again soon', async () => {
  widgets = shelfRows();
  hub.connectedCallback();
  hub.add('/api/activity', ['reading', 'last-watched', 'on-repeat'], shelfFromLive, shelfText);
  answers.push(answer(body()));
  await elapse();
  const { reading: _, ...partial } = body({ reading: ' 2', lastWatched: ' 2', listening: ' 2' });
  // A malformed row counts as left out too.
  answers.push(answer({ ...partial, listening: { title: '' } }, 600));
  await elapse();
  assert.deepEqual(titles(), [
    'reading · Dune',
    'last watched · \u2068Clueless 2\u2069 (1995)',
    'on repeat · STAY ALIVE',
  ]);
  assert.equal(delay(), 600_000);
  // A valid null row clears that row alone.
  answers.push(answer({ reading: null }, 600));
  await elapse();
  assert.equal(titles()[0], 'reading · —');
  assert.equal(titles()[1], 'last watched · \u2068Clueless 2\u2069 (1995)');
});

test('a near-expiry answer from the edge is asked for again when it goes stale', async () => {
  widgets = shelfRows();
  hub.connectedCallback();
  hub.add('/api/activity', ['reading', 'last-watched', 'on-repeat'], shelfFromLive, shelfText);
  answers.push(answer(body(), 86_400, 86_000));
  await elapse();
  assert.equal(delay(), 400_000);
  // One already stale waits a minute, and so does one with no Expires.
  answers.push(answer(body(), 86_400, 90_000));
  await elapse();
  assert.equal(delay(), 60_000);
  answers.push(() => Response.json(body(), { headers: { 'cache-control': 'max-age=86400' } }));
  await elapse();
  assert.equal(delay(), 60_000);
});

test('failures back off, keep every text, and a hidden page waits until shown', async () => {
  widgets = shelfRows();
  hub.connectedCallback();
  hub.add('/api/activity', ['reading', 'last-watched', 'on-repeat'], shelfFromLive, shelfText);
  answers.push(
    () => Promise.reject(new TypeError('offline')),
    () => new Response('null', { status: 200 }),
    () => new Response('', { status: 503 }),
    answer({ coding: body().coding }),
  );
  const waits = [await elapse()];
  for (let turn = 0; turn < 3; turn++) {
    waits.push(await elapse());
  }
  // The fourth answer has no row for /shelf, so it is a failure here too.
  assert.deepEqual(waits, [0, 120_000, 240_000, 600_000]);
  assert.equal(delay(), 600_000);
  assert.deepEqual(titles(), ['build', 'build', 'build']);
  page.hidden = true;
  for (const listener of listeners) {
    listener();
  }
  assert.equal(timers.size, 0);
  now += 3_600_000;
  page.hidden = false;
  answers.push(answer(body()));
  for (const listener of listeners) {
    listener();
  }
  assert.equal(await elapse(), 0);
  assert.equal(titles()[0], 'reading · Dune');
  assert.equal(requests.length, 5);
});

test('a timer never waits past a day, even after the clock moves back', async () => {
  widgets = shelfRows();
  hub.connectedCallback();
  hub.add('/api/activity', ['reading', 'last-watched', 'on-repeat'], shelfFromLive, shelfText);
  answers.push(answer(body()));
  await elapse();
  now -= 2 * 86_400_000;
  for (const listener of listeners) {
    listener();
  }
  assert.equal(delay(), 86_400_000);
});

test('/now: the coding cell reads the coding value alone and keeps its text without one', async () => {
  const cell = new Widget({ widget: 'coding', state: 'idle' }, ['today', 'language', 'time']);
  widgets = [cell];
  hub.connectedCallback();
  hub.add('/api/activity', ['coding'], codingFromLive, codingText);
  answers.push(answer(body()));
  await elapse();
  assert.deepEqual(requests, ['/api/activity']);
  assert.equal(cell.holders.today.textContent, '2h 10m that day');
  assert.equal(cell.dataset.state, 'idle');
  assert.equal(delay(), 86_400_000);
  // The coding source failed: the rows came, the cell keeps its text, marked offline.
  const { coding: _, ...rest } = body();
  answers.push(answer(rest, 600));
  await elapse();
  assert.equal(cell.holders.today.textContent, '2h 10m that day');
  assert.equal(cell.dataset.state, 'offline');
  assert.equal(delay(), 120_000);
});

test('an empty coding holder gains and clears its heartbeat datetime', async () => {
  const cell = new Widget({ widget: 'coding', state: 'empty' }, ['today', 'language', 'time']);
  cell.holders.time.textContent = '';
  widgets = [cell];
  hub.connectedCallback();
  hub.add('/api/activity', ['coding'], codingFromLive, codingText);
  answers.push(answer(body()));
  await elapse();
  assert.equal(cell.holders.time.getAttribute('datetime'), body().coding.at);
  assert.equal(cell.holders.time.textContent, 'heartbeat 2026-11-01T11:00Z');
  answers.push(
    answer({ coding: { state: 'empty', language: null, today: null, at: null, shares: [] } }),
  );
  await elapse();
  assert.equal(cell.holders.time.getAttribute('datetime'), null);
  assert.equal(cell.holders.time.textContent, '');
});

test('a daily coding snapshot keeps an absolute heartbeat after a hidden page resumes', async () => {
  const cell = new Widget({ widget: 'coding', state: 'idle' }, ['today', 'language', 'time']);
  widgets = [cell];
  hub.connectedCallback();
  hub.add('/api/activity', ['coding'], codingFromLive, codingText);
  const snapshot = body();
  snapshot.coding.at = '2026-11-01T11:55:00.000Z';
  answers.push(answer(snapshot));
  await elapse();
  const heartbeat = 'heartbeat 2026-11-01T11:55Z';
  assert.equal(cell.holders.time.textContent, heartbeat);
  page.hidden = true;
  for (const listener of listeners) {
    listener();
  }
  now += 12 * 3_600_000;
  page.hidden = false;
  for (const listener of listeners) {
    listener();
  }
  assert.equal(cell.holders.time.textContent, heartbeat);
  assert.equal(delay(), 12 * 3_600_000);
  assert.deepEqual(requests, ['/api/activity']);
});

test('the music widgets ask /api/now-playing each minute, by its Expires', async () => {
  const line = new Widget({ widget: 'presence', state: 'idle' }, ['state', 'track', 'artist']);
  widgets = [line];
  hub.connectedCallback();
  const track = {
    state: 'idle',
    track: 'Song',
    artist: 'Band',
    album: null,
    at: '2026-11-01T11:00:00.000Z',
    url: null,
    artwork: null,
  };
  answers.push(answer(track, 60), answer(track, 60, 50));
  assert.equal(await elapse(), 0);
  assert.equal(line.holders.track.textContent, 'Song');
  assert.equal(await elapse(), 60_000);
  // A hit 50 s old goes stale in 10 s, but the next poll waits the minute.
  assert.equal(delay(), 60_000);
  assert.deepEqual(requests, ['/api/now-playing', '/api/now-playing']);
});
