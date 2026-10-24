// The theme restore must be the only inline script, and the /* rule's CSP in public/_headers must
// allow scripts from exactly 'self' and its hash as built, or the browser blocks the restore.
// Run after `bun run build`; exits 1 on a mismatch.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

const problems: string[] = [];
const hashes = new Set<string>();
for (const page of readdirSync('dist', { recursive: true, encoding: 'utf8' })) {
  if (!page.endsWith('.html')) {
    continue;
  }
  const scripts = readFileSync(`dist/${page}`, 'utf8').matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/g,
  );
  const inline = [...scripts].filter(([, attrs]) => !/\bsrc=|\btype="[^"]*json/i.test(attrs));
  if (inline.length !== 1) {
    problems.push(`${page} has ${inline.length} inline scripts; only the theme restore may be one`);
  }
  for (const [, , body] of inline) {
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
}
// A rule is a path line and the indented header lines under it.
const rule = readFileSync('public/_headers', 'utf8')
  .split(/\n(?=\S)/)
  .find((block) => block.startsWith('/*\n'));
const policy = /^\s*Content-Security-Policy:(.*)$/im.exec(rule ?? '')?.[1] ?? '';
const found = /(?:^|;)\s*script-src\s([^;]*)/.exec(policy)?.[1].trim().split(/\s+/) ?? [];
const wanted = ["'self'", ...hashes];
if (found.length !== wanted.length || !wanted.every((source) => found.includes(source))) {
  problems.push(`/* script-src is "${found.join(' ')}"; the build needs "${wanted.join(' ')}"`);
}
for (const problem of problems) {
  console.error(problem);
}
if (!problems.length) {
  console.log(`script-src matches the theme restore: ${wanted.join(' ')}`);
}
process.exitCode = problems.length ? 1 : 0;
