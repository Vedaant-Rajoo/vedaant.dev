import type { Coding } from '../data/coding';
import {
  fromLive,
  type NowPlaying,
  nowPlayingText,
  presenceState,
  presenceText,
} from '../data/now-playing';
import type { Shelf } from '../data/shelf-live';

// The one <presence-hub> per page (Base.astro) keeps the live widgets current. Each feed reads one
// of the site's own endpoints: the music widgets /api/now-playing, and, added by its page's own
// script, the /now coding cell or /shelf's three rows /api/activity, so a page asks each endpoint
// once per poll. A feed with widgets on the page polls at once, then, while the page is shown,
// when its answer goes stale: the answer's Expires, which the Function sets from its Date and
// max-age, so the Function alone sets the cadence, a minute for the music and up to a day for
// activity. One request at a time, later after failures, each feed on its own (FR-LV-4). The same
// max-age keeps an answer in the browser's cache, so a poll or another page before it goes stale
// reaches no Function. The hub drives only widgets built from the build-time value; a state
// fixture carries data-fixture.
type Value = NowPlaying | Coding | Shelf;
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
    // coding cell's, or a shelf row's by its data-row hooks, with the date for its <time>; none
    // leaves the widget as it is.
    readonly text?: (
      value: never,
      widget: HTMLElement,
    ) => Record<string, string | null | undefined> | undefined,
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
    // Unknown, as after a failure, until an answer names it.
    let stale: number | undefined;
    try {
      // One 5 s budget for the request and its body; the Functions answer within about 4 s. The
      // browser's cache answers while the last answer is fresh.
      const response = await fetch(this.path, { signal: AbortSignal.timeout(5_000) });
      value = response.ok ? this.read(await response.json()) : null;
      // When the answer goes stale, as the Function says.
      stale = Date.parse(response.headers.get('expires') as string);
    } catch {}
    this.failures = value ? 0 : this.failures + 1;
    this.last = value ?? this.last;
    for (const widget of this.widgets) {
      if (!value) {
        fail(widget, this.last);
      } else if ('state' in value) {
        show(widget, value.state, value, this.text);
      } else {
        const texts = this.text?.(value as never, widget);
        if (texts) {
          write(widget, 'row', texts, texts.date);
        }
      }
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

function texts(kind: string | undefined, shown: string, value: NowPlaying, widget: HTMLElement) {
  return kind === 'presence'
    ? presenceText(shown, value)
    : nowPlayingText(shown, value, widget.dataset.variant === 'cell' ? ' ' : ' · ');
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
    text?.(value as never, widget) ?? texts(kind, shown, value as NowPlaying, widget),
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

    // A feed a page's own script adds, as the coding cell's and /shelf's do, so no other page loads
    // its code. The hub still makes every request.
    add(...feed: ConstructorParameters<typeof Feed>) {
      start(new Feed(...feed));
    }
  },
);

// The hub element as a page's script sees it.
export type Hub = HTMLElement & { add(...feed: ConstructorParameters<typeof Feed>): void };
