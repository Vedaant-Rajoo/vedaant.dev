import type { Coding } from '../data/coding';
import {
  fromLive,
  type NowPlaying,
  nowPlayingText,
  presenceState,
  presenceText,
} from '../data/now-playing';
import type { Shelf } from '../data/shelf-live';
import type { Parts } from './now-feed';

// The one <presence-hub> per page (Base.astro) keeps the live widgets current. Each feed reads one
// of the site's own endpoints: the music widgets /api/now-playing, and, added by its page's own
// script, /now's four daily cells or /shelf's three rows /api/activity, once per poll.
// One request at a time, later after failures, each feed on its own (FR-LV-4).
// Only widgets built from the build-time value are driven; state fixtures carry data-fixture.
// /now's value is composite: each cell takes its own part.
type Value = NowPlaying | Coding | Shelf | Parts | NonNullable<Parts[keyof Parts]>;
// Seconds before the next poll after one, two and three or more failures in a row.
const waits = [120, 240, 600];

class Feed {
  widgets: HTMLElement[] = [];
  failures = 0;
  due = 0;
  busy = false;
  timer: ReturnType<typeof setTimeout> | undefined;
  last: Value | undefined;

  constructor(
    readonly path: string,
    readonly kinds: string[],
    readonly read: (body: unknown) => Value | null,
    // An added feed's texts, from its own read's value (hence never), for one of its widgets: the
    // coding cell's, a /now cell's or a shelf row's by its data-row hooks, with the date for its
    // <time>; none leaves the widget as it is.
    readonly text?: (
      value: never,
      widget: HTMLElement,
    ) => Record<string, string | null | undefined> | undefined,
    // A composite value's part for one widget, as /now's four cells take theirs: undefined when the
    // answer leaves it out or it fails its check, which is that widget's failure while the others
    // update; null is a value, nothing current. Without one, every widget takes the whole value.
    readonly part?: (value: never, widget: HTMLElement) => Value | null | undefined,
  ) {}

  schedule = () => {
    clearTimeout(this.timer);
    if (this.widgets.length > 0 && !this.busy && !document.hidden) {
      // setTimeout reads its delay as a signed 32-bit number, so the negative wait before the first
      // poll, or a long one after the clock moves back, could wrap into weeks: keep it within the
      // longest wait, 0–86,400 s.
      this.timer = setTimeout(this.poll, Math.min(Math.max(this.due - Date.now(), 0), 86_400_000));
    }
  };

  poll = async () => {
    this.busy = true;
    let value: Value | null = null;
    let stale: number | undefined;
    try {
      // One 5 s budget for the request and its body; the Functions answer within about 4 s. The
      // browser's cache answers while the last answer is fresh.
      const response = await fetch(this.path, { signal: AbortSignal.timeout(5_000) });
      value = response.ok ? this.read(await response.json()) : null;
      stale = Date.parse(response.headers.get('expires') as string);
    } catch {}
    this.failures = value ? 0 : this.failures + 1;
    this.last = value ?? this.last;
    for (const widget of this.widgets) {
      // Without a part, every widget takes the whole value; a failed poll gives each none. A widget
      // whose texts throw keeps the texts it shows, and the others and the next poll go on.
      try {
        const own = value && this.part ? this.part(value as never, widget) : value;
        this.update(widget, value ? own : undefined);
      } catch {}
    }
    this.busy = false;
    // After a success, when the answer goes stale, so the next poll finds the browser's copy stale
    // too; never within a minute, which also bounds a clock ahead of the Function's, and a minute
    // when the answer names no time. After failures, the backoff.
    // shortcut: a client clock behind the server delays polling; correct for skew if reported.
    const now = Date.now();
    this.due = this.failures
      ? now + waits[Math.min(this.failures, 3) - 1] * 1000
      : Math.max(stale as number, now + 60_000) || now + 60_000;
    this.schedule();
  };

  // One widget's part of a poll: none fails it, one with a state is shown, and any other, a null
  // row too, is written with the feed's texts for the widget, unless it has none.
  update(widget: HTMLElement, own: Value | null | undefined) {
    if (own === undefined) {
      fail(widget, this.last);
    } else if (own && 'state' in own) {
      show(widget, own.state, own, this.text);
    } else {
      const texts = this.text?.(own as never, widget);
      if (texts) {
        write(widget, 'row', texts, texts.date);
      }
    }
  }
}

const feeds = [new Feed('/api/now-playing', ['now-playing', 'presence'], fromLive)];
const schedule = () => {
  for (const feed of feeds) {
    feed.schedule();
  }
};

// The answer names its artwork: a new URL replaces the image, none hides it, and the same URL
// leaves it as it is, hidden too if it failed to load.
function showArtwork(widget: HTMLElement, { artwork = null }: NowPlaying) {
  const image = widget.querySelector<HTMLImageElement>('[data-now-playing="artwork"]');
  if (!image || image.getAttribute('src') === artwork) {
    return;
  }
  attribute(image, 'src', artwork);
  image.hidden = !artwork;
}

const attribute = (element: Element, name: string, value: string | null) =>
  value ? element.setAttribute(name, value) : element.removeAttribute(name);

function texts(kind: string | undefined, shown: string, value: NowPlaying) {
  return kind === 'presence' ? presenceText(shown, value) : nowPlayingText(shown, value);
}

// A feed's own texts, as the coding cell's, replace the music widgets'.
function show(widget: HTMLElement, state: string, value: NowPlaying | Coding, text?: Feed['text']) {
  const kind = widget.dataset.widget;
  const shown = kind === 'presence' ? presenceState(state, value as NowPlaying) : state;
  widget.dataset.state = shown;
  widget.removeAttribute('aria-busy');
  if (kind === 'coding') {
    widget
      .querySelector('language-mix')
      ?.setAttribute('data-shares', JSON.stringify((value as Coding).shares));
  }
  if (kind === 'now-playing') {
    showArtwork(widget, value as NowPlaying);
    attribute(widget, 'href', (value as NowPlaying).url);
  }
  write(
    widget,
    kind,
    text?.(value as never, widget) ?? texts(kind, shown, value as NowPlaying),
    value.at,
  );
}

// Writes each text into its holder, [data-<kind>="<name>"], and `at` on a <time>.
function write(
  widget: HTMLElement,
  kind: string | undefined,
  texts: object,
  at: string | null = null,
) {
  for (const [name, text] of Object.entries(texts)) {
    // Always a new text node, even for the same text: a kept node that moves when the text before
    // it changes counts as a layout shift.
    const holder = widget.querySelector(`[data-${kind}="${name}"]`);
    if (holder) {
      holder.textContent = text;
    }
    if (holder instanceof HTMLTimeElement) {
      attribute(holder, 'datetime', at);
    }
  }
}

// A failed poll keeps every text and marks a kept value offline. Live is the exception: "now"
// would no longer be true, so it shows the same value as offline, worded as idle. A shelf row has
// no state, so it only keeps its text.
function fail(widget: HTMLElement, last: Value | undefined) {
  const state = widget.dataset.state;
  if (!state) {
    return;
  }
  if (state === 'live' && last && 'state' in last) {
    show(widget, 'offline', last);
  } else {
    widget.dataset.state = state === 'idle' || state === 'offline' ? 'offline' : 'empty';
    widget.removeAttribute('aria-busy');
  }
}

// Gives every feed its widgets on the page and polls those that have any.
function start(...more: Feed[]) {
  feeds.push(...more);
  const widgets = [...document.querySelectorAll<HTMLElement>('[data-widget]:not([data-fixture])')];
  for (const feed of feeds) {
    feed.widgets = widgets.filter(({ dataset }) => feed.kinds.includes(dataset.widget ?? ''));
  }
  addEventListener('visibilitychange', schedule);
  schedule();
}

customElements.define(
  'presence-hub',
  class extends HTMLElement {
    connectedCallback() {
      for (const image of this.ownerDocument.querySelectorAll<HTMLImageElement>(
        '[data-now-playing="artwork"]',
      )) {
        image.addEventListener('error', () => {
          image.hidden = true;
        });
        if (image.complete && image.hasAttribute('src') && image.naturalWidth === 0) {
          image.hidden = true;
        }
      }
      start();
    }

    disconnectedCallback() {
      removeEventListener('visibilitychange', schedule);
      for (const feed of feeds) {
        feed.widgets = [];
        clearTimeout(feed.timer);
      }
    }

    // A feed a page's own script adds, as /now's and /shelf's do, so no other page loads its code.
    // The hub still makes every request.
    add(...feed: ConstructorParameters<typeof Feed>) {
      start(new Feed(...feed));
    }
  },
);

// The hub element as a page's script sees it.
export type Hub = HTMLElement & { add(...feed: ConstructorParameters<typeof Feed>): void };
