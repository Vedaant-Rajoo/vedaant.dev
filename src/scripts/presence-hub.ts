import { type Coding, codingFromLive, codingText } from '../data/coding';
import {
  fromLive,
  type NowPlaying,
  nowPlayingText,
  presenceState,
  presenceText,
} from '../data/now-playing';

// The one <presence-hub> per page (Base.astro) keeps the live widgets current. Each of the site's
// own endpoints is a feed: the music widgets read /api/now-playing and the coding cell /api/coding.
// A feed with widgets on the page polls at once, then a minute after each answer while the page is
// shown, one request at a time, and later after failures, each feed on its own (FR-LV-4). Answers
// carry max-age=0, so every poll reaches the edge, which keeps them for 30 or 60 s. The hub drives
// only widgets built from the build-time value; a state fixture carries data-fixture.
type Value = NowPlaying | Coding;
const waits = [60, 120, 240, 600];

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
  ) {}

  schedule = () => {
    clearTimeout(this.timer);
    if (this.widgets.length > 0 && !this.busy && !document.hidden) {
      // setTimeout reads its delay as a signed 32-bit number, so the negative wait before the first
      // poll, or a long one after the clock moves back, could wrap into weeks: keep it in 0–600 s.
      this.timer = setTimeout(this.poll, Math.min(Math.max(this.due - Date.now(), 0), 600_000));
    }
  };

  poll = async () => {
    this.busy = true;
    let value: Value | null = null;
    try {
      // One 5 s budget for the request and its body; the Functions answer within about 4 s.
      const response = await fetch(this.path, { signal: AbortSignal.timeout(5_000) });
      value = response.ok ? this.read(await response.json()) : null;
    } catch {}
    this.failures = value ? 0 : this.failures + 1;
    this.last = value ?? this.last;
    for (const widget of this.widgets) {
      if (value) {
        show(widget, value.state, value);
      } else {
        fail(widget, this.last);
      }
    }
    this.busy = false;
    this.due = Date.now() + waits[Math.min(this.failures, 3)] * 1000;
    this.schedule();
  };
}

const feeds = [
  new Feed('/api/now-playing', ['now-playing', 'presence'], fromLive),
  new Feed('/api/coding', ['coding'], codingFromLive),
];
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

function texts(kind: string | undefined, shown: string, value: Value, widget: HTMLElement) {
  if (kind === 'coding') {
    return codingText(shown, value as Coding);
  }
  return kind === 'presence'
    ? presenceText(shown, value as NowPlaying)
    : nowPlayingText(shown, value as NowPlaying, widget.dataset.variant === 'cell' ? ' ' : ' · ');
}

function show(widget: HTMLElement, state: string, value: Value) {
  const kind = widget.dataset.widget;
  const shown = kind === 'presence' ? presenceState(state, value as NowPlaying) : state;
  widget.dataset.state = shown;
  widget.removeAttribute('aria-busy');
  if (kind === 'now-playing') {
    showArtwork(widget, value as NowPlaying);
    attribute(widget, 'href', (value as NowPlaying).url);
  }
  for (const [name, text] of Object.entries(texts(kind, shown, value, widget))) {
    // Always a new text node, even for the same text: a kept node that moves when the text before
    // it changes counts as a layout shift.
    const holder = widget.querySelector(`[data-${kind}="${name}"]`);
    if (holder) {
      holder.textContent = text;
    }
    if (holder instanceof HTMLTimeElement) {
      attribute(holder, 'datetime', value.at);
    }
  }
}

// A failed poll keeps every text and marks a kept value offline. Live is the exception: "now"
// would no longer be true, so it shows the same value as offline, worded as idle.
function fail(widget: HTMLElement, last: Value | undefined) {
  const state = widget.dataset.state;
  if (state === 'live' && last) {
    show(widget, 'offline', last);
  } else {
    widget.dataset.state = state === 'idle' || state === 'offline' ? 'offline' : 'empty';
    widget.removeAttribute('aria-busy');
  }
}

customElements.define(
  'presence-hub',
  class extends HTMLElement {
    connectedCallback() {
      const widgets = [
        ...document.querySelectorAll<HTMLElement>('[data-widget]:not([data-fixture])'),
      ];
      for (const feed of feeds) {
        feed.widgets = widgets.filter(({ dataset }) => feed.kinds.includes(dataset.widget ?? ''));
      }
      if (widgets.length > 0) {
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
        addEventListener('visibilitychange', schedule);
        schedule();
      }
    }

    disconnectedCallback() {
      removeEventListener('visibilitychange', schedule);
      for (const feed of feeds) {
        feed.widgets = [];
        clearTimeout(feed.timer);
      }
    }
  },
);
