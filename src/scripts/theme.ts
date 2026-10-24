// The clock is the theme button: a click moves light → dark → system and stores the
// choice for the head script in Base.astro. System removes data-theme, so CSS follows
// the OS, and gives the theme-color metas back their media queries.
const themes = ['light', 'dark', 'system'] as const;
type Theme = (typeof themes)[number];

const root = document.documentElement;
const button = document.getElementById('theme-toggle') as HTMLButtonElement;
const time = button.querySelector('time') as HTMLTimeElement;
const [light, dark] = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
const media = {
  light: ['all', 'not all'],
  dark: ['not all', 'all'],
  system: ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'],
};
const next = (theme: Theme) => themes[(themes.indexOf(theme) + 1) % themes.length];
const osDark = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const paintsDark = (theme: Theme) => theme === 'dark' || (theme === 'system' && osDark.matches);

function stored(): Theme {
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      return theme;
    }
  } catch {}
  return 'system';
}

// The time on screen leads the name, then the theme now and next.
function label(theme: Theme) {
  const text = `${time.textContent}, switch theme: now ${theme}, next ${next(theme)}`;
  button.setAttribute('aria-label', text);
}

function show(theme: Theme) {
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
  root.dataset.themePref = theme;
  [light.media, dark.media] = media[theme];
  label(theme);
}

let theme = stored();
show(theme);
button.addEventListener('click', () => {
  const wasDark = paintsDark(theme);
  theme = next(theme);
  // The new theme is revealed in a circle from the clock (global.css). It swaps at once when
  // it paints like the old one, when the browser lacks the API, or under reduced motion.
  if (wasDark === paintsDark(theme) || !document.startViewTransition || reducedMotion.matches) {
    show(theme);
  } else {
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    // Percentages of the viewport, which the circle's box fills (a radius percentage is of its
    // diagonal / √2): Chromium draws px lengths in this clip at 1/devicePixelRatio of their size.
    const d = Math.hypot(innerWidth, innerHeight) / Math.SQRT2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.style.setProperty('--vt-x', `${(x / innerWidth) * 100}%`);
    root.style.setProperty('--vt-y', `${(y / innerHeight) * 100}%`);
    root.style.setProperty('--vt-r', `${(r / d) * 100}%`);
    // show(theme) runs once the old page is captured and applies the latest choice. A second
    // click before then cancels this reveal and rejects ready; the theme still ends right.
    document.startViewTransition(() => show(theme)).ready.catch(() => {});
  }
  try {
    localStorage.setItem('theme', theme);
  } catch {}
});
// A page restored from the back/forward cache still shows the theme it had when it was left.
addEventListener('pageshow', (event) => {
  if (event.persisted) {
    theme = stored();
    show(theme);
  }
});

// The clock's own zone, from its data-zone (site.timeZone), never the visitor's. The options and
// the parts below repeat Clock.astro's build-time format: change both together.
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: time.dataset.zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});
let timer: ReturnType<typeof setTimeout> | undefined;

// Shows the minute now, then runs again just after the next one starts. Both use one instant, so
// a minute that turns in between is shown by that next run. The text, datetime and label change
// only with the minute.
function tick() {
  const now = Date.now();
  const parts = Object.fromEntries(
    clock.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const text = `${parts.hour}:${parts.minute}`;
  const offset = parts.timeZoneName.slice(3) || '+00:00';
  const datetime = `${parts.year}-${parts.month}-${parts.day}T${text}${offset}`;
  if (time.dateTime !== datetime) {
    time.textContent = text;
    time.dateTime = datetime;
    label(theme);
  }
  clearTimeout(timer);
  timer = setTimeout(tick, 60_000 - (now % 60_000));
}

tick();
// A page shown again, also from the back/forward cache, updates at once, not when a timer that
// the browser slowed or paused fires.
addEventListener('visibilitychange', tick);
