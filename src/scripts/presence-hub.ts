import { artworkKey, getArtwork } from '../data/artwork';
import { ago, type NowPlaying, recentTracks, toNowPlaying } from '../data/now-playing';

// The one <presence-hub> per page (Base.astro) keeps the music widgets current (FR-LV-4). It reads
// Last.fm from the browser (D92): at once, then a minute after each answer while the page is shown,
// one request at a time, and later after failures or when Last.fm's Cache-Control asks. It drives
// only widgets built from the build-time value; a state fixture (S23) carries data-fixture.
let widgets: HTMLElement[] = [];
// Seconds to wait after none, one, two, and three or more failures in a row.
const waits = [60, 120, 240, 600];
let failures = 0;
let due = 0;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
// Last.fm's latest answer, kept for a live value that a failure turns offline.
let last: NowPlaying | undefined;

function schedule() {
  clearTimeout(timer);
  if (widgets.length > 0 && !busy && !document.hidden) {
    // setTimeout reads its delay as a signed 32-bit number, so a negative or a longer wait would
    // wrap into another one: wait between 0 and about 24.8 days, then check the due time again.
    const wait = Math.min(Math.max(due - Date.now(), 0), 2 ** 31 - 1);
    timer = setTimeout(() => (Date.now() < due ? schedule() : poll()), wait);
  }
}

// Cache-Control's max-age in seconds, or 0. Directive names are case-insensitive, a value may be
// quoted, a comma inside quotes does not end a directive, and a value too large counts as 2^31
// seconds (RFC 9111 §1.2.2, §5.2).
function maxAge(header: string | null) {
  for (const directive of header?.match(/(?:"(?:[^"\\]|\\.)*"|[^,"])+/g) ?? []) {
    const match = /^\s*max-age=(?:(\d+)|"(\d+)")\s*$/i.exec(directive);
    if (match) {
      return Math.min(Number(match[1] ?? match[2]), 2 ** 31);
    }
  }
  return 0;
}

// One widget's holders as its component builds them for a state and value: change both together.
// The hub keeps these holders and the artwork image in place. It changes text, state, links,
// datetime and the image's src/hidden attributes, never adding or removing an element (FR-LV-1).
function texts(kind: string | undefined, state: string, value: NowPlaying, lead: string) {
  const { track, artist, album, at } = value;
  const live = state === 'live';
  const age = at && !live ? ago(at) : '';
  if (kind === 'now-playing') {
    const rest = artist && `${lead}\u2068${artist}\u2069${album ? ` · \u2068${album}\u2069` : ''} `;
    return { track: track ?? '—', rest: rest ?? '', time: live ? 'now' : age };
  }
  // Presence.astro; its city never changes.
  if (state === 'empty') {
    return { state: '—', track: '', artist: '', age: '' };
  }
  return {
    state: live ? 'listening — ' : 'not listening — last: ',
    track: track ?? '',
    artist: live ? ` · \u2068${artist}\u2069` : '',
    age: age && ` · ${age}`,
  };
}

// Presence.astro's own rules: no track reads empty, and live without an artist reads idle.
function stateFor(kind: string | undefined, state: string, { track, artist }: NowPlaying) {
  if (kind !== 'presence') {
    return state;
  }
  if (!track?.trim()) {
    return 'empty';
  }
  return state === 'live' && !artist?.trim() ? 'idle' : state;
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

function show(widget: HTMLElement, state: string, value: NowPlaying) {
  const kind = widget.dataset.widget;
  const shown = stateFor(kind, state, value);
  widget.dataset.state = shown;
  widget.removeAttribute('aria-busy');
  if (kind === 'now-playing') {
    void showArtwork(widget, value);
    if (value.url) {
      widget.setAttribute('href', value.url);
    } else {
      widget.removeAttribute('href');
    }
  }
  // The /now cell starts the artist on a line of its own, so only the row puts a separator first.
  const lead = widget.dataset.variant === 'cell' ? ' ' : ' · ';
  for (const [name, text] of Object.entries(texts(kind, shown, value, lead))) {
    // Always a new text node, even for the same text: a kept node that moves when the text before
    // it changes counts as a layout shift (S21b's zero-shift contract).
    const holder = widget.querySelector(`[data-${kind}="${name}"]`);
    if (holder) {
      holder.textContent = text;
    }
    if (holder instanceof HTMLTimeElement) {
      if (value.at) {
        holder.dateTime = value.at;
      } else {
        holder.removeAttribute('datetime');
      }
    }
  }
}

// A failed poll keeps every text (FR-LV-4) and marks a kept value offline. Live is the exception:
// "now" would no longer be true, so it shows the same value as offline, worded as idle (S21b, S22).
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
  let asked = 0;
  let value: NowPlaying | null = null;
  try {
    // One 5 s budget for the request and its body, as at build (lastfm.ts).
    const response = await fetch(recentTracks, { signal: AbortSignal.timeout(5_000) });
    asked = maxAge(response.headers.get('cache-control'));
    value = response.ok ? toNowPlaying(await response.json()) : null;
  } catch {
    // Blocked, offline, timed out or not JSON: a failure like any other, and silent.
  }
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
  due = Date.now() + Math.max(waits[Math.min(failures, 3)], asked) * 1000;
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
