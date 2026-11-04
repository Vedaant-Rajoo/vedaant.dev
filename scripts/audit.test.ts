import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('audit uses median performance, keeps strict gates, and retains CI reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-test-'));
  const script = readFileSync(new URL('./audit.sh', import.meta.url), 'utf8');
  const reports: string[] = [];
  try {
    for (const directory of ['scripts', 'dist', 'bin']) {
      mkdirSync(join(root, directory));
    }
    writeFileSync(join(root, 'scripts/audit.sh'), script);
    writeFileSync(join(root, 'dist/index.html'), '');
    writeFileSync(join(root, 'bin/bunx'), '#!/bin/sh\nexec sleep 60\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(
      join(root, 'bin/npx'),
      `#!/bin/sh
for arg; do
  case "$arg" in --output-path=*)
    file="\${arg#--output-path=}"
    run="\${file%.report.json}"
    run="\${run##*.}"
    case "$run" in 1|2|3) ;; *) run=1 ;; esac
    cp "$AUDIT_FIXTURE.$run" "$file"
    printf '{}' > "$file.trace.json"
    printf '%s' "$file" > "$AUDIT_CAPTURE"
  esac
done
`,
      { mode: 0o755 },
    );
    for (const [ci, scores, expected, cls, accessibility] of [
      [true, [0.86, 1, 1], 0, 0, 1],
      [false, [0.86, 0.86, 0.86], 1, 0, 1],
      [true, [0.86, 0.86, 0.86], 1, 0, 1],
      [true, [1, 1, 1], 0, 0, 1],
      [true, [1, 1, 1], 1, 0.014, 1],
      [true, [1, 1, 1], 1, 0, 0.94],
    ] as const) {
      const fixture = join(root, 'fixture.json');
      for (const [index, score] of scores.entries()) {
        writeFileSync(
          `${fixture}.${index + 1}`,
          JSON.stringify({
            finalDisplayedUrl: 'http://127.0.0.1:4331/',
            categories: {
              performance: { id: 'performance', score },
              accessibility: { id: 'accessibility', score: [accessibility, 1, 1][index] },
            },
            audits: Object.fromEntries(
              Object.entries({
                'first-contentful-paint': 1100,
                'largest-contentful-paint': 1267,
                'speed-index': 1100,
                'total-blocking-time': 500,
                'cumulative-layout-shift': index === 0 ? cls : 0,
              }).map(([id, numericValue]) => [id, { numericValue }]),
            ),
          }),
        );
      }
      const output = join(root, 'output');
      const capture = join(root, 'capture');
      const result = spawnSync('sh', ['scripts/audit.sh'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          GITHUB_OUTPUT: ci ? output : '',
          AUDIT_FIXTURE: fixture,
          AUDIT_CAPTURE: capture,
        },
      });
      const report = readFileSync(capture, 'utf8');
      reports.push(dirname(report));
      assert.equal(result.status, expected, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /FCP 1100 ms, LCP 1267 ms, Speed Index 1100 ms, TBT 500 ms, CLS 0/,
      );
      assert.equal(existsSync(report), ci);
      if (ci) {
        assert.ok(readFileSync(output, 'utf8').includes(`reports=${dirname(report)}\n`));
      }
    }
  } finally {
    for (const report of reports) {
      rmSync(report, { recursive: true, force: true });
    }
    rmSync(root, { recursive: true, force: true });
  }
});
