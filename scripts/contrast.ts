// Contrast of the Ledger colour tokens against the background, of the text that sits on
// --c-surface against it, of the non-text marks against the background, and of the text on the
// translucent --c-mark highlight, both themes, for the oklch values and for the hex fallbacks. Run
// `bun scripts/contrast.ts`; it reads src/styles/tokens.css and exits 1 when a pair is under its
// target.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TARGETS: Record<string, number> = { fg: 15, 'fg-2': 8, 'fg-3': 4.5, live: 4.6, focus: 3 };
const ON_SURFACE: Record<string, number> = {
  fg: 14,
  'fg-2': 8,
  'code-keyword': 8,
  'code-string': 8,
};
// Non-text marks on --c-bg, ≥3:1, by use: the link underline and each step of the neutral ramp.
const NON_TEXT: [use: string, token: string, target: number][] = [
  ['underline', 'fg-3', 3],
  ...[1, 2, 3, 4, 5].map((step): [string, string, number] => ['ramp', `ramp-${step}`, 3]),
];
// The heatmap's levels 1 to 4 (ramp-2 to ramp-5) on its level 0 (--c-sunken), ≥3:1, so a day with
// any contribution stands apart from a day with none as well as from the page.
const ON_LEVEL_0 = [2, 3, 4, 5].map((step) => `ramp-${step}`);
// --c-fg on the --c-mark highlight composited on what lies under it, at WCAG AA for normal text: the
// 15:1 body target is on --c-bg only. A <mark>'s band lies on --c-bg and its text inherits --c-fg;
// ::selection sets --c-fg on any ground that carries text, a selected mark's band included.
const ON_MARK: [use: string, ground: string][] = [
  ['mark band, selection', 'mark on bg'],
  ['selection', 'mark on surface'],
  ['selection', 'mark on sunken'],
  ['selection in a mark', 'mark on mark on bg'],
];
const HIGHLIGHT = 4.5;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
// rgb holds the gamma-encoded channels, 0 to 255 and unrounded, so a composite rounds only once.
type Swatch = { rgb: number[]; hex: string; clipped: boolean; alpha: number };
const swatch = (rgb: number[], clipped: boolean, alpha: number): Swatch => ({
  rgb,
  hex: `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
  clipped,
  alpha: Math.min(1, Math.max(0, alpha)),
});

function oklchToLinear(L: number, C: number, hDeg: number): number[] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function oklchToSwatch(L: number, C: number, hDeg: number, alpha: number): Swatch {
  const linear = oklchToLinear(L, C, hDeg);
  const encoded = linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  });
  return swatch(
    encoded,
    linear.some((v) => v < 0 || v > 1),
    alpha,
  );
}

// Source-over on the gamma-encoded sRGB channels, as browsers paint the page; the ground is opaque.
function over(top: Swatch, base: Swatch): Swatch {
  if (base.alpha !== 1) {
    throw new Error(`cannot composite on the translucent ${base.hex} / ${base.alpha}`);
  }
  const rgb = top.rgb.map((t, i) => t * top.alpha + base.rgb[i] * (1 - top.alpha));
  return swatch(rgb, top.clipped || (top.alpha < 1 && base.clipped), 1);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The token syntaxes read below. oklch: `--c-x: light-dark(oklch(L% C H), oklch(L% C H))`, each
// with an optional ` / alpha`. Hex copies: `--c-x: #rrggbb` or `--c-x: rgb(R G B / alpha)`.
// shortcut: other spellings fail as missing tokens; extend when tokens.css needs another syntax.
const OKLCH = String.raw`oklch\(([\d.]+)% ([\d.]+) ([\d.]+)(?: / ([\d.]+))?\)`;
const pair = new RegExp(String.raw`--c-([\w-]+):\s*light-dark\(${OKLCH},\s*${OKLCH}\)`, 'g');
const flat = /--c-([\w-]+):\s*(?:(#[0-9a-f]{6})\b|rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\))/gi;
const fromOklch = ([L, C, h, alpha]: string[]) =>
  oklchToSwatch(Number(L) / 100, Number(C), Number(h), Number(alpha ?? 1));
const fromFlat = (m: RegExpMatchArray) =>
  swatch(
    m[2]
      ? [1, 3, 5].map((i) => Number.parseInt(m[2].slice(i, i + 2), 16))
      : m.slice(3, 6).map((v) => Math.min(255, Math.max(0, Number(v)))),
    false,
    Number(m[6] ?? 1),
  );

// Self-checks: the WCAG endpoints, and the three sRGB primaries through the matrices from
// Ottosson's reference OKLab values, to a tolerance that catches a typo in any matrix row.
if (Math.abs(ratio('#000000', '#ffffff') - 21) > 1e-9) {
  throw new Error('self-check failed: black on white must be 21:1');
}
const PRIMARIES: [number, number, number, number[]][] = [
  [0.627955, 0.224863, 0.125846, [1, 0, 0]],
  [0.86644, -0.233888, 0.179498, [0, 1, 0]],
  [0.452014, -0.032457, -0.311528, [0, 0, 1]],
];
for (const [L, a, b, rgb] of PRIMARIES) {
  const linear = oklchToLinear(L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI);
  if (linear.some((v, i) => Math.abs(v - rgb[i]) > 1e-3)) {
    throw new Error(`self-check failed: OKLab ${L} ${a} ${b} must be sRGB ${rgb}, got ${linear}`);
  }
}
// The parsers keep each alpha, defaulting to 1, and the compositor blends encoded channels: half
// white on black is #808080, where blending linear light would give #bcbcbc.
const [half, black, upper] = [
  ...'--c-a: rgb(255 255 255 / 0.5); --c-b: #000000; --c-c: #ABCDEF;'.matchAll(flat),
].map(fromFlat);
const red = [
  ...'--c-x: light-dark(oklch(62.8% 0.2577 29.23 / 0.25), oklch(0% 0 0))'.matchAll(pair),
].flatMap((m) => [fromOklch(m.slice(2, 6)), fromOklch(m.slice(6, 10))]);
assert.deepEqual(
  [half, black, upper, ...red].map(({ hex, alpha }) => `${hex} / ${alpha}`),
  ['#ffffff / 0.5', '#000000 / 1', '#abcdef / 1', '#ff0000 / 0.25', '#000000 / 1'],
);
assert.equal(over(half, black).hex, '#808080');
// CSS clamps out-of-range channels and alpha before compositing.
assert.deepEqual(
  [
    fromFlat([...'--c-x: rgb(256 300 999 / 3)'.matchAll(flat)][0]),
    fromOklch(['62.8', '0.2577', '29.23', '3']),
  ].map(({ hex, alpha }) => `${hex} / ${alpha}`),
  ['#ffffff / 1', '#ff0000 / 1'],
);

// Read the tokens: every oklch pair, then every `:root…` block inside the
// `@supports not (color: light-dark(…))` block (found by brace matching); a selector naming dark
// (`[data-theme="dark"]` or `:not([data-theme="light"])`) is the dark theme, any other is light;
// every copy must declare every measured token, and copies of a theme must agree.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const oklch: Record<Theme, Record<string, Swatch>> = { light: {}, dark: {} };
const hex: Record<Theme, Record<string, Swatch>> = { light: {}, dark: {} };
for (const m of css.matchAll(pair)) {
  oklch.light[m[1]] = fromOklch(m.slice(2, 6));
  oklch.dark[m[1]] = fromOklch(m.slice(6, 10));
}
const start = css.indexOf('@supports not (color: light-dark(');
if (start < 0) {
  throw new Error('tokens.css has no @supports not (color: light-dark(…)) hex block');
}
let end = css.indexOf('{', start);
for (let depth = 0; end < css.length; end += 1) {
  if (css[end] === '{') {
    depth += 1;
  } else if (css[end] === '}') {
    depth -= 1;
    if (depth === 0) {
      break;
    }
  }
}
const required = [
  ...new Set([
    ...Object.keys(TARGETS),
    ...Object.keys(ON_SURFACE),
    ...NON_TEXT.map(([, token]) => token),
    'bg',
    'surface',
    'sunken',
    'mark',
  ]),
];
for (const block of css.slice(start, end).matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
  const theme: Theme = /\[data-theme="dark"\]|:not\(\[data-theme="light"\]\)/.test(block[1])
    ? 'dark'
    : 'light';
  const names = new Set<string>();
  for (const m of block[2].matchAll(flat)) {
    const value = fromFlat(m);
    const seen = hex[theme][m[1]];
    if (seen && (seen.hex !== value.hex || seen.alpha !== value.alpha)) {
      throw new Error(
        `--c-${m[1]} differs between the ${theme} hex copies: ${seen.hex} / ${seen.alpha}, ${value.hex} / ${value.alpha}`,
      );
    }
    hex[theme][m[1]] = value;
    names.add(m[1]);
  }
  const missing = names.size ? required.filter((k) => !names.has(k)) : [];
  if (missing.length) {
    throw new Error(
      `the ${theme} hex copy at "${block[1].trim()}" is missing --c-${missing.join(', --c-')}`,
    );
  }
}

// public/favicon.svg repeats the --c-sunken (.t) and --c-fg (.i) hex fallbacks, light in the base
// rules and dark inside its prefers-color-scheme block. public/ is outside the gate's colour grep,
// so this is what catches the icon drifting from a token edit.
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const dark = svg.indexOf('@media(prefers-color-scheme:dark)');
for (const [theme, part] of [
  ['light', svg.slice(0, dark)],
  ['dark', svg.slice(dark)],
] as const) {
  for (const [cls, token] of [
    ['t', 'sunken'],
    ['i', 'fg'],
  ]) {
    const found = part
      .match(new RegExp(`\\.${cls}\\{fill:(#[0-9a-f]{6})\\}`, 'i'))?.[1]
      .toLowerCase();
    const want = hex[theme][token].hex;
    if (found !== want) {
      throw new Error(`favicon.svg ${theme} .${cls} is ${found}, but --c-${token} is ${want}`);
    }
  }
}

let failed = 0;
const clip = (s: Swatch) => (s.clipped ? ' (clipped)' : '');
console.log('| theme | pair | source | colour | on | ratio | target | result |');
console.log('|---|---|---|---|---|---|---|---|');
for (const theme of THEMES) {
  for (const [source, swatches] of [
    ['oklch', oklch[theme]],
    ['hex', hex[theme]],
  ] as const) {
    const get = (name: string): Swatch => {
      const found = swatches[name];
      if (!found) {
        throw new Error(`token --c-${name} missing from the ${source} ${theme} set`);
      }
      return found;
    };
    const mark = get('mark');
    const band = over(mark, get('bg'));
    const grounds: Record<string, Swatch> = {
      'mark on bg': band,
      'mark on surface': over(mark, get('surface')),
      'mark on sunken': over(mark, get('sunken')),
      'mark on mark on bg': over(mark, band),
    };
    for (const [ground, name, target, use] of [
      ...Object.entries(TARGETS).map(([n, t]) => ['bg', n, t, ''] as const),
      ...Object.entries(ON_SURFACE).map(([n, t]) => ['surface', n, t, ''] as const),
      ...NON_TEXT.map(([use, n, t]) => ['bg', n, t, ` (${use})`] as const),
      ...ON_LEVEL_0.map((n) => ['sunken', n, 3, ' (heatmap on level 0)'] as const),
      ...ON_MARK.map(([use, g]) => [g, 'fg', HIGHLIGHT, ` (${use})`] as const),
    ]) {
      const bg = grounds[ground] ?? get(ground);
      const fg = over(get(name), bg);
      const r = ratio(fg.hex, bg.hex);
      const pass = r >= target;
      failed += pass ? 0 : 1;
      console.log(
        `| ${theme} | ${name}${use} | ${source} | ${fg.hex}${clip(fg)} | ${ground} ${bg.hex}${clip(bg)} | ${r.toFixed(2)}:1 | ≥ ${target} | ${pass ? 'pass' : 'FAIL'} |`,
      );
    }
  }
}
console.log(failed ? `\n${failed} pair(s) under target` : '\nall pairs pass');
process.exitCode = failed ? 1 : 0;
