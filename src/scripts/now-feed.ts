import { type Coding, codingFromLive, codingText } from '../data/coding';
import {
  type Contributions,
  cells,
  contributionsFromLive,
  contributionsText,
} from '../data/contributions';
import {
  type LastWatched,
  type Reading,
  readingCell,
  shelfFromLive,
  watchedCell,
} from '../data/shelf-live';
import type { Hub } from './presence-hub';

// /now's one feed: the coding, contributions, reading and last-watched values of one /api/activity
// answer, the one /shelf's rows read. Each is checked on its own and handed to the cell whose
// data-widget names it, so a value the answer leaves out, or one that fails its check, keeps its
// cell's last value while the others update; a reading or last-watched null is a value, "—". The
// coding cell's script adds it, so /now needs no script of its own (one would cost about 135 B).
export interface Parts {
  coding?: Coding;
  contributions?: Contributions;
  reading?: Reading | null;
  'last-watched'?: LastWatched | null;
}

// Every value the answer has that passes its check; null when none does, so the hub backs off.
function read(body: unknown): Parts | null {
  const { reading, lastWatched } = shelfFromLive(body) ?? {};
  const parts = {
    coding: codingFromLive(body) ?? undefined,
    contributions: contributionsFromLive(body) ?? undefined,
    reading,
    'last-watched': lastWatched,
  };
  return Object.values(parts).some((part) => part !== undefined) ? parts : null;
}

// Redraws the heatmap from a new value: each of the 371 squares' level and title, in day order,
// re-anchored to the value's `end`, never the calendar's size; then the cell's texts for the hub to
// write. A value older than the one shown, as a cached answer can be after a build, leaves the cell
// as it is.
function heat(widget: HTMLElement, value: Contributions) {
  if (value.end < (widget.querySelector('time')?.dateTime ?? '')) {
    return undefined;
  }
  const slots = cells(value);
  widget.querySelectorAll('[data-heat] rect').forEach((square, i) => {
    const slot = slots[i];
    if (slot) {
      square.setAttribute('data-level', `${slot.level}`);
    } else {
      square.removeAttribute('data-level');
    }
    (square.firstChild as Node).textContent = slot?.title ?? '';
  });
  return contributionsText(value);
}

// Each cell's texts from its own value, as the hub writes them into its data-coding or data-row
// holders. The <abbr> around a date holds the whole date, as at build. `value` is the part the
// last entry below picks by the same data-widget; TypeScript cannot check that, as it is never.
function text(value: never, widget: HTMLElement) {
  const kind = widget.dataset.widget;
  if (kind === 'coding') {
    return codingText(value, widget);
  }
  if (kind === 'contributions') {
    return heat(widget, value);
  }
  const texts = kind === 'reading' ? readingCell(value) : watchedCell(value);
  const abbr = widget.querySelector('abbr');
  if (abbr) {
    abbr.title = texts.full;
  }
  return texts;
}

export const nowFeed: Parameters<Hub['add']> = [
  '/api/activity',
  ['coding', 'contributions', 'reading', 'last-watched'],
  read,
  text,
  (value: Parts, widget: HTMLElement) => value[widget.dataset.widget as keyof Parts],
];
