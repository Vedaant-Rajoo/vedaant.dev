import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { cells } from '../data/contributions';
import { shelfFromLive, shelfText } from '../data/shelf-live';
import { nowFeed } from './now-feed';
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
class Time extends Element {
  get dateTime() {
    return this.getAttribute('datetime') ?? '';
  }
}
class Widget extends Element {
  holders: Record<string, Element>;
  constructor(
    readonly dataset: Record<string, string>,
    names: string[],
  ) {
    super();
    this.holders = Object.fromEntries(
      names.map((name) => [name, /^(meta|time|updated)$/.test(name) ? new Time() : new Element()]),
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

// The coding cell names the clock's zone, as Coding.astro writes it.
const zone = 'Asia/Kolkata';

test('/now: the coding cell reads the coding value and keeps its text without one', async () => {
  const cell = new Widget({ widget: 'coding', state: 'idle', zone }, ['today', 'language', 'time']);
  widgets = [cell];
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(body()));
  await elapse();
  assert.deepEqual(requests, ['/api/activity']);
  assert.equal(cell.holders.today.textContent, '2h 10m that day');
  assert.equal(cell.dataset.state, 'idle');
  assert.equal(delay(), 86_400_000);
  // The coding source failed: the rows came, the cell keeps its text, marked offline, and the
  // answer, kept 10 minutes, is asked for again when it goes stale.
  const { coding: _, ...rest } = body();
  answers.push(answer(rest, 600));
  await elapse();
  assert.equal(cell.holders.today.textContent, '2h 10m that day');
  assert.equal(cell.dataset.state, 'offline');
  assert.equal(delay(), 600_000);
});

test('a coding holder gains and clears its heartbeat datetime, idle without one too', async () => {
  const cell = new Widget({ widget: 'coding', state: 'empty', zone }, [
    'today',
    'language',
    'time',
  ]);
  cell.holders.time.textContent = '';
  widgets = [cell];
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(body()));
  await elapse();
  assert.equal(cell.holders.time.getAttribute('datetime'), body().coding.at);
  assert.equal(cell.holders.time.textContent, 'last heartbeat 1 Nov, 16:30');
  // A day with coding whose last heartbeat fell on a later day: idle with no heartbeat line, as the
  // build writes it.
  answers.push(
    answer({ coding: { state: 'idle', language: 'Go', today: '45m', at: null, shares: [] } }),
  );
  await elapse();
  assert.equal(cell.dataset.state, 'idle');
  assert.equal(cell.holders.today.textContent, '45m that day');
  assert.equal(cell.holders.language.textContent, 'top language Go');
  assert.equal(cell.holders.time.getAttribute('datetime'), null);
  assert.equal(cell.holders.time.textContent, '');
  answers.push(
    answer({ coding: { state: 'empty', language: null, today: null, at: null, shares: [] } }),
  );
  await elapse();
  assert.equal(cell.holders.time.getAttribute('datetime'), null);
  assert.equal(cell.holders.time.textContent, '');
});

test('a daily coding snapshot keeps an absolute heartbeat after a hidden page resumes', async () => {
  const cell = new Widget({ widget: 'coding', state: 'idle', zone }, ['today', 'language', 'time']);
  widgets = [cell];
  hub.connectedCallback();
  hub.add(...nowFeed);
  const snapshot = body();
  snapshot.coding.at = '2026-11-01T11:55:00.000Z';
  answers.push(answer(snapshot));
  await elapse();
  const heartbeat = 'last heartbeat 1 Nov, 17:25';
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
  const cell = new Widget({ widget: 'now-playing', state: 'idle' }, ['track', 'rest', 'time']);
  widgets = [line, cell];
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
  // The /now cell puts the artist on a line of its own, with no separator before it.
  assert.equal(cell.holders.track.textContent, 'Song');
  assert.equal(cell.holders.rest.textContent, '\u2068Band\u2069');
  assert.equal(cell.holders.time.getAttribute('datetime'), track.at);
  assert.equal(await elapse(), 60_000);
  // A hit 50 s old goes stale in 10 s, but the next poll waits the minute.
  assert.equal(delay(), 60_000);
  assert.deepEqual(requests, ['/api/now-playing', '/api/now-playing']);
});

// /now's other three daily cells as Heatmap.astro and ShelfCell.astro build them: the calendar's
// 371 squares, each with its <title>, and the <abbr> around a cell's date.
class Square extends Element {
  firstChild = { textContent: 'build' };
}
class Heat extends Widget {
  squares = Array.from({ length: 371 }, () => new Square());
  constructor() {
    super({ widget: 'contributions' }, ['total', 'since', 'updated']);
    // The build's calendar, older than every answer below.
    this.holders.updated.setAttribute('datetime', '2026-10-25');
  }
  querySelector(selector: string) {
    return selector === 'time' ? this.holders.updated : super.querySelector(selector);
  }
  querySelectorAll(selector: string) {
    assert.equal(selector, '[data-heat] rect');
    return this.squares;
  }
}
class Cell extends Widget {
  abbr = { title: 'build' };
  querySelector(selector: string) {
    return selector === 'abbr' ? (this.abbr as unknown as Element) : super.querySelector(selector);
  }
}
const nowCells = () =>
  [
    new Widget({ widget: 'coding', state: 'idle', zone }, ['today', 'language', 'time']),
    new Heat(),
    new Cell({ widget: 'reading' }, ['tile', 'name', 'sub', 'lead', 'meta']),
    new Cell({ widget: 'last-watched' }, ['tile', 'name', 'sub', 'stars', 'rated', 'meta']),
  ] as const;
// A window ending on `end`, one count per day, each day's count its index mod 5.
const calendar = (end: string) => ({
  end,
  days: Array.from({ length: 365 + new Date(end).getUTCDay() }, (_, i) => i % 5),
});
const nowBody = (end = '2026-11-01') => ({
  ...body(),
  reading: { title: 'Dune', creator: 'Frank Herbert', started: '2026-10', page: 42 },
  contributions: calendar(end),
});
const texts = (widget: Widget) =>
  Object.fromEntries(Object.entries(widget.holders).map(([name, e]) => [name, e.textContent]));
const squares = (heat: Heat) =>
  heat.squares.map((square) => [square.getAttribute('data-level'), square.firstChild.textContent]);

test('/now: one request per poll feeds the coding, heatmap, reading and last-watched cells', async () => {
  const page4 = nowCells();
  const [coding, heat, reading, watched] = page4;
  widgets = [...page4];
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(nowBody()));
  assert.equal(await elapse(), 0);
  assert.deepEqual(requests, ['/api/activity']);
  assert.equal(coding.holders.today.textContent, '2h 10m that day');
  // Sunday 2026-11-01: 365 days from 2 Nov 2025, the last column one day, six blank squares.
  assert.deepEqual(texts(heat), {
    total: '730 contributions',
    since: 'since 2 Nov 2025',
    updated: 'updated 1 Nov 2026',
  });
  assert.equal(heat.holders.updated.getAttribute('datetime'), '2026-11-01');
  const slots = cells(calendar('2026-11-01'));
  assert.deepEqual(
    squares(heat),
    slots.map((slot) => (slot ? [String(slot.level), slot.title] : [null, ''])),
  );
  assert.deepEqual(squares(heat)[1], ['1', '1 contribution on 3 Nov 2025']);
  assert.deepEqual(texts(reading), {
    tile: 'du',
    name: 'Dune',
    sub: 'Frank Herbert · p. 42',
    lead: 'started ',
    meta: 'Oct ’26',
  });
  assert.equal(reading.holders.meta.getAttribute('datetime'), '2026-10');
  assert.equal(reading.abbr.title, 'started October 2026');
  assert.deepEqual(texts(watched), {
    tile: 'cl',
    name: '\u2068Clueless\u2069 (1995)',
    sub: '',
    stars: '',
    rated: '',
    meta: '28 Oct',
  });
  assert.equal(watched.holders.meta.getAttribute('datetime'), '2026-10-28');
  assert.equal(watched.abbr.title, '28 October 2026');
  assert.equal(delay(), 86_400_000);
  answers.push(answer(nowBody()));
  await elapse();
  assert.equal(requests.length, 2);
});

test('/now: a partial answer updates what it has, and a null row reads "—"', async () => {
  const page4 = nowCells();
  const [coding, heat, reading, watched] = page4;
  widgets = [...page4];
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(nowBody()));
  await elapse();
  const before = { heat: texts(heat), squares: squares(heat) };
  // No coding, a calendar one day short, nothing being read, and a new film, rated.
  const { coding: _, ...rest } = nowBody();
  answers.push(
    answer(
      {
        ...rest,
        contributions: { end: '2026-11-02', days: calendar('2026-11-01').days },
        reading: null,
        lastWatched: { title: 'Heat', year: 1995, rating: 4.5, date: '2026-11-01' },
      },
      600,
    ),
  );
  await elapse();
  assert.equal(coding.holders.today.textContent, '2h 10m that day');
  assert.equal(coding.dataset.state, 'offline');
  assert.deepEqual({ heat: texts(heat), squares: squares(heat) }, before);
  assert.deepEqual(texts(reading), { tile: '', name: '—', sub: '', lead: '', meta: '' });
  assert.equal(reading.holders.meta.getAttribute('datetime'), null);
  assert.equal(reading.abbr.title, '');
  assert.deepEqual(texts(watched), {
    tile: 'he',
    name: '\u2068Heat\u2069 (1995)',
    sub: '',
    stars: '★★★★½',
    rated: 'rated 4.5 of 5',
    meta: '1 Nov',
  });
  assert.equal(watched.abbr.title, '1 November 2026');
  // A success, kept 10 minutes: asked for again when it goes stale.
  assert.equal(delay(), 600_000);
});

test("/now: failures keep every cell's last value and back off", async () => {
  const page4 = nowCells();
  const [coding, heat, reading, watched] = page4;
  widgets = [...page4];
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(nowBody()));
  await elapse();
  const before = {
    heat: texts(heat),
    squares: squares(heat),
    reading: texts(reading),
    watched: texts(watched),
    abbr: [reading.abbr.title, watched.abbr.title],
  };
  answers.push(
    () => new Response('', { status: 503 }),
    () => new Response('null', { status: 200 }),
    // Only /shelf's on-repeat row: nothing for /now, so a failure here.
    answer({ listening: body().listening }, 600),
  );
  const waits = [await elapse(), await elapse(), await elapse()];
  assert.deepEqual(waits, [86_400_000, 120_000, 240_000]);
  assert.equal(delay(), 600_000);
  assert.equal(coding.dataset.state, 'offline');
  assert.equal(coding.holders.today.textContent, '2h 10m that day');
  assert.deepEqual(
    {
      heat: texts(heat),
      squares: squares(heat),
      reading: texts(reading),
      watched: texts(watched),
      abbr: [reading.abbr.title, watched.abbr.title],
    },
    before,
  );
  assert.equal(requests.length, 4);
});

test("/now: the heatmap re-anchors at a week's rollover and never goes back", async () => {
  const heat = new Heat();
  widgets = [heat];
  hub.connectedCallback();
  hub.add(...nowFeed);
  // Saturday 2026-10-31: 371 days from 26 Oct 2025, every square drawn.
  answers.push(answer(nowBody('2026-10-31'), 600));
  await elapse();
  assert.equal(texts(heat).since, 'since 26 Oct 2025');
  assert.deepEqual(squares(heat)[0], ['0', 'no contributions on 26 Oct 2025']);
  assert.ok(squares(heat).every(([level]) => level !== null));
  // Sunday: the oldest week leaves on the left, a one-day column starts, six squares go blank.
  answers.push(answer(nowBody('2026-11-01'), 600));
  await elapse();
  assert.equal(texts(heat).since, 'since 2 Nov 2025');
  assert.equal(texts(heat).updated, 'updated 1 Nov 2026');
  assert.deepEqual(squares(heat)[0], ['0', 'no contributions on 2 Nov 2025']);
  assert.deepEqual(squares(heat)[364], ['4', '4 contributions on 1 Nov 2026']);
  assert.deepEqual(squares(heat).slice(365), Array(6).fill([null, '']));
  // A cached answer older than the one shown changes nothing; the same day again redraws.
  const shown = { heat: texts(heat), squares: squares(heat) };
  answers.push(answer(nowBody('2026-10-31'), 600));
  await elapse();
  assert.deepEqual({ heat: texts(heat), squares: squares(heat) }, shown);
  assert.equal(heat.holders.updated.getAttribute('datetime'), '2026-11-01');
  answers.push(answer({ contributions: { end: '2026-11-01', days: Array(365).fill(0) } }, 600));
  await elapse();
  assert.equal(texts(heat).total, 'no public activity');
  assert.ok(
    squares(heat)
      .slice(0, 365)
      .every(([level]) => level === '0'),
  );
});

test('/now: a cell whose texts throw keeps its texts, and the others and the feed go on', async () => {
  const page4 = nowCells();
  const [coding, heat, reading] = page4;
  widgets = [...page4];
  // A calendar whose squares lost their <title>s: heat() throws on the first.
  for (const square of heat.squares) {
    (square as { firstChild: unknown }).firstChild = null;
  }
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(nowBody()));
  await elapse();
  assert.equal(heat.holders.total.textContent, 'build');
  assert.equal(coding.holders.today.textContent, '2h 10m that day');
  assert.equal(reading.holders.name.textContent, 'Dune');
  assert.equal(delay(), 86_400_000);
});

test('/now: a cell without an <abbr> still gets its texts', async () => {
  const watched = new Widget({ widget: 'last-watched' }, ['name', 'meta']);
  widgets = [watched];
  hub.connectedCallback();
  hub.add(...nowFeed);
  answers.push(answer(nowBody()));
  await elapse();
  assert.equal(watched.holders.name.textContent, '⁨Clueless⁩ (1995)');
  assert.equal(watched.holders.meta.getAttribute('datetime'), '2026-10-28');
});
