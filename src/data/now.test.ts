import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// /now renders now.md's body as a list of labelled paragraphs, so the file keeps that shape: plain
// lowercase "## label" sections of paragraphs, at most 400 words.
const body = readFileSync('src/content/now/now.md', 'utf8')
  .replace(/^---\n[\s\S]*?\n---\n/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim();
const sections = body.split(/^## (.*)$/m);

test('now.md is "## label" sections only, each label lowercase and unique', () => {
  assert.equal(sections[0].trim(), '', 'the body must start with a "## label" line');
  const labels = sections.filter((_, i) => i % 2 === 1).map((label) => label.trim());
  for (const label of labels) {
    assert.ok(
      label !== '' && label === label.toLowerCase(),
      `"## ${label}" needs a lowercase label`,
    );
  }
  assert.equal(new Set(labels).size, labels.length, 'a label appears twice');
});

test('now.md holds paragraphs of text: no lists, quotes, headings, code blocks, images or HTML blocks', () => {
  const prose = sections.filter((_, i) => i > 0 && i % 2 === 0).join('\n');
  const block = /^\s*(?:[-*+]\s|\d+[.)]\s|>|#|```|~~~|!\[|<(?!(?:a|em|strong|del|code|br)\b))/m;
  assert.doesNotMatch(prose, block);
  assert.ok(prose.trim() !== '', 'no "## label" has text under it');
  const words = prose
    .replace(/\]\([^)]*\)/g, ']')
    .split(/\s+/)
    .filter(Boolean).length;
  assert.ok(words <= 400, `the prose is ${words} words; at most 400`);
});
