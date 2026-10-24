import { artworkKey, getArtwork } from '../data/artwork';
import {
  type NowPlaying,
  nowPlayingText,
  presenceState,
  presenceText,
  recentTracks,
  toNowPlaying,
} from '../data/now-playing';

// The one <presence-hub> per page (Base.astro) keeps the music widgets current. It reads Last.fm
// from the browser: at once, then a minute after each answer while the page is shown, one request
// at a time, and later after failures. Last.fm sends no Cache-Control; the browser's HTTP cache
// would honour one. It drives only widgets built from the build-time value; a state fixture
// carries data-fixture.
let widgets: HTMLElement[] = [];
const waits = [60, 120, 240, 600];
let failures = 0;
let due = 0;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let last: NowPlaying | undefined;

function schedule() {
  clearTimeout(timer);
  if (widgets.length > 0 && !busy && !document.hidden) {
    timer = setTimeout(poll, due - Date.now());
  }
}

async function showArtwork(widget: HTMLElement, value: NowPlaying) {
  const image = widget.querySelector<HTMLImageElement>('[data-now-playing="artwork"]');
  const key = artworkKey(value);
  if (!image || widget.dataset.artworkKey === key) {
    return;
  }
  widget.dataset.artworkKey = key;
  image.hidden = true;
  image.removeAttribute('src');
  const src = await getArtwork(value);
  // A later track or a disconnected page must never receive this track's artwork.
  if (src && widget.isConnected && widget.dataset.artworkKey === key) {
    image.src = src;
    image.hidden = false;
  }
}

const attribute = (element: Element, name: string, value: string | null) =>
  value ? element.setAttribute(name, value) : element.removeAttribute(name);

function show(widget: HTMLElement, state: string, value: NowPlaying) {
  const kind = widget.dataset.widget;
  const shown = kind === 'presence' ? presenceState(state, value) : state;
  widget.dataset.state = shown;
  widget.removeAttribute('aria-busy');
  if (kind === 'now-playing') {
    void showArtwork(widget, value);
    attribute(widget, 'href', value.url);
  }
  const texts =
    kind === 'presence'
      ? presenceText(shown, value)
      : nowPlayingText(shown, value, widget.dataset.variant === 'cell' ? ' ' : ' · ');
  for (const [name, text] of Object.entries(texts)) {
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
function fail(widget: HTMLElement) {
  const state = widget.dataset.state;
  if (state === 'live' && last) {
    show(widget, 'offline', last);
  } else {
    widget.dataset.state = state === 'idle' || state === 'offline' ? 'offline' : 'empty';
    widget.removeAttribute('aria-busy');
  }
}

async function poll() {
  busy = true;
  let value: NowPlaying | null = null;
  try {
    // One 5 s budget for the request and its body, as at build (lastfm.ts).
    const response = await fetch(recentTracks, { signal: AbortSignal.timeout(5_000) });
    value = response.ok ? toNowPlaying(await response.json()) : null;
  } catch {}
  failures = value ? 0 : failures + 1;
  last = value ?? last;
  for (const widget of widgets) {
    if (value) {
      show(widget, value.state, value);
    } else {
      fail(widget);
    }
  }
  busy = false;
  due = Date.now() + waits[Math.min(failures, 3)] * 1000;
  schedule();
}

customElements.define(
  'presence-hub',
  class extends HTMLElement {
    connectedCallback() {
      widgets = [...document.querySelectorAll<HTMLElement>('[data-widget]:not([data-fixture])')];
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
      widgets = [];
      removeEventListener('visibilitychange', schedule);
      clearTimeout(timer);
    }
  },
);
