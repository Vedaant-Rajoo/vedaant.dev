// Contrast of the Ledger colour tokens against the background, and of the text
// that sits on --c-surface against it, both themes, for the oklch values and for the hex
// fallbacks. Run `bun scripts/contrast.ts`; it reads src/styles/tokens.css and exits 1 when a
// pair is under its target.
import { readFileSync } from 'node:fs';

const TARGETS: Record<string, number> = { fg: 15, 'fg-2': 8, 'fg-3': 4.5, live: 4.6, focus: 3 };
// On --c-surface: a row title on the hover fill and the text of a code block.
const ON_SURFACE: Record<string, number> = {
  fg: 14,
  'fg-2': 8,
  'code-keyword': 8,
  'code-string': 8,
};
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
type Swatch = { hex: string; clipped: boolean };

// oklch -> OKLab -> LMS -> linear sRGB (Ottosson's matrices).
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

// Linear sRGB clipped to the cube, then the sRGB transfer, 8-bit hex.
function oklchToSwatch(L: number, C: number, hDeg: number): Swatch {
  const linear = oklchToLinear(L, C, hDeg);
  const clipped = linear.some((v) => v < 0 || v > 1);
  const bytes = linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, '0');
  });
  return { hex: `#${bytes.join('')}`, clipped };
}

// WCAG 2 relative luminance and contrast ratio from 8-bit sRGB hex.
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

// Read the tokens. oklch: `--c-x: light-dark(oklch(L% C H), oklch(L% C H))`; a pair with an alpha
// channel, such as --c-mark, has no target and is skipped. Hex: every `:root…` block inside the
// `@supports not (color: light-dark(…))` block (found by brace matching); a selector naming dark
// (`[data-theme="dark"]` or `:not([data-theme="light"])`) is the dark theme, any other is light;
// every copy must declare every measured token, and copies of a theme must agree.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const oklch: Record<Theme, Record<string, Swatch>> = { light: {}, dark: {} };
const hex: Record<Theme, Record<string, Swatch>> = { light: {}, dark: {} };
const pair =
  /--c-([\w-]+):\s*light-dark\(oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\),\s*oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)\)/g;
for (const m of css.matchAll(pair)) {
  oklch.light[m[1]] = oklchToSwatch(Number(m[2]) / 100, Number(m[3]), Number(m[4]));
  oklch.dark[m[1]] = oklchToSwatch(Number(m[5]) / 100, Number(m[6]), Number(m[7]));
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
  ...new Set([...Object.keys(TARGETS), ...Object.keys(ON_SURFACE), 'bg', 'surface']),
];
for (const block of css.slice(start, end).matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
  const theme: Theme = /\[data-theme="dark"\]|:not\(\[data-theme="light"\]\)/.test(block[1])
    ? 'dark'
    : 'light';
  const names = new Set<string>();
  for (const m of block[2].matchAll(/--c-([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) {
    const value = m[2].toLowerCase();
    const seen = hex[theme][m[1]];
    if (seen && seen.hex !== value) {
      throw new Error(`--c-${m[1]} differs between the ${theme} hex copies: ${seen.hex}, ${value}`);
    }
    hex[theme][m[1]] = { hex: value, clipped: false };
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
console.log('| theme | pair | source | colour | on | ratio | target | result |');
console.log('|---|---|---|---|---|---|---|---|');
for (const theme of THEMES) {
  for (const [source, swatches] of [
    ['oklch', oklch[theme]],
    ['hex', hex[theme]],
  ] as const) {
    for (const [ground, name, target] of [
      ...Object.entries(TARGETS).map(([n, t]) => ['bg', n, t] as const),
      ...Object.entries(ON_SURFACE).map(([n, t]) => ['surface', n, t] as const),
    ]) {
      const fg = swatches[name];
      const bg = swatches[ground];
      if (!fg || !bg) {
        throw new Error(
          `token --c-${name} or --c-${ground} missing from the ${source} ${theme} set`,
        );
      }
      const r = ratio(fg.hex, bg.hex);
      const pass = r >= target;
      failed += pass ? 0 : 1;
      const clip = fg.clipped || bg.clipped ? ' (clipped)' : '';
      console.log(
        `| ${theme} | ${name} | ${source} | ${fg.hex}${clip} | ${ground} ${bg.hex} | ${r.toFixed(2)}:1 | ≥ ${target} | ${pass ? 'pass' : 'FAIL'} |`,
      );
    }
  }
}
console.log(failed ? `\n${failed} pair(s) under target` : '\nall pairs pass');
process.exitCode = failed ? 1 : 0;
