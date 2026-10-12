// The clock is the theme button (FR-SH-2): a click moves light → dark → system and stores the
// choice for the head script in Base.astro (FR-SH-3). System removes data-theme, so CSS follows
// the OS, and gives the theme-color metas back their media queries.
const themes = ['light', 'dark', 'system'] as const;
type Theme = (typeof themes)[number];

const root = document.documentElement;
const button = document.getElementById('theme-toggle') as HTMLButtonElement;
const time = button.querySelector('time') as HTMLTimeElement;
const [light, dark] = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
// The media of the light and the dark theme-color meta per theme; the first that matches wins.
const media = {
  light: ['all', 'not all'],
  dark: ['not all', 'all'],
  system: ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'],
};
const next = (theme: Theme) => themes[(themes.indexOf(theme) + 1) % themes.length];
const osDark = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Whether a theme paints the page dark; system follows the OS.
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

function show(theme: Theme) {
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
  root.dataset.themePref = theme;
  [light.media, dark.media] = media[theme];
  // The time on screen leads the name (WCAG 2.5.3), then the theme now and next (FR-SH-2).
  const label = `${time.textContent}, switch theme: now ${theme}, next ${next(theme)}`;
  button.setAttribute('aria-label', label);
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
