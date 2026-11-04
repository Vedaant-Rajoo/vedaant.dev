import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { tag, tags } from '../data/coding';

// Only the DOM operations used by language-mix; execute its real script without shipping a test hook.
class Element {
  attributes = new Map<string, string>();
  classes = new Set<string>();
  textContent = '';
  classList = {
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force: boolean) => {
      if (force) {
        this.classes.add(name);
      } else {
        this.classes.delete(name);
      }
    },
  };
  constructor(readonly children: Record<string, Element[]> = {}) {}
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  toggleAttribute(name: string, force: boolean) {
    if (force) {
      this.attributes.set(name, '');
    } else {
      this.attributes.delete(name);
    }
  }
  querySelectorAll(selector: string) {
    return this.children[selector] ?? [];
  }
  querySelector(selector: string) {
    const element = this.querySelectorAll(selector)[0];
    assert.ok(element, selector);
    return element;
  }
}

function checkSlot(
  segment: Element,
  item: Element,
  row: [string, number, number] | undefined,
  i: number,
) {
  const [name, percent, x] = row ?? ['', 0, 100];
  const other = name === 'other' ? '' : null;
  assert.equal(segment.getAttribute('data-other'), other);
  assert.match(segment.getAttribute('style') ?? '', new RegExp(`--w: ${percent}$`));
  if (row) {
    assert.equal(segment.getAttribute('style'), `--x: ${x}; --w: ${percent}`);
  }
  assert.equal(segment.querySelector('[data-mix-tag]').textContent, row ? tag(tags, name) : '');
  assert.equal(segment.querySelector('[data-mix-name]').textContent, name || (i === 0 ? '—' : ''));
  assert.equal(segment.querySelector('[data-mix-percent]').textContent, row ? `${percent}%` : '');
  assert.equal(item.querySelector('[data-mix-name]').textContent, name || (i === 0 ? '—' : ''));
  assert.equal(item.querySelector('[data-mix-percent]').textContent, row ? `${percent}%` : '');
  assert.equal(item.getAttribute('data-other'), other);
}

test('language mix updates empty, populated, reduced and cleared slots', () => {
  const source = readFileSync('src/components/Coding.astro', 'utf8');
  assert.match(source, /<time data-coding="time" datetime=\{value.at\}>/);
  const script = source.split('<script>')[1].split('</script>')[0];
  let Mix!: new () => Element & { attributeChangedCallback(): void };
  runInNewContext(
    ts.transpile(script.slice(script.indexOf("customElements.define('language-mix'"))),
    {
      tag,
      HTMLElement: Element,
      customElements: {
        define: (_: string, element: typeof Mix) => {
          Mix = element;
        },
      },
    },
  );
  const segments = Array.from(
    { length: 6 },
    () =>
      new Element({
        '[data-mix-tag]': [new Element()],
        '[data-mix-name]': [new Element()],
        '[data-mix-percent]': [new Element()],
      }),
  );
  const legend = Array.from(
    { length: 6 },
    () =>
      new Element({
        '[data-mix-name]': [new Element()],
        '[data-mix-percent]': [new Element()],
        svg: [new Element()],
      }),
  );
  const mix = new Mix();
  mix.setAttribute('data-tags', JSON.stringify(tags));
  mix.children['[data-mix-segment]'] = segments;
  mix.children.li = legend;
  for (const layout of [
    [],
    [
      ['TypeScript', 60, 0],
      ['Go', 30, 60],
      ['other', 10, 90],
    ],
    [['Go', 100, 0]],
    [],
  ] as [string, number, number][][]) {
    mix.setAttribute(
      'data-shares',
      JSON.stringify(layout.map(([name, percent]) => ({ name, percent }))),
    );
    mix.attributeChangedCallback();
    for (const [i, segment] of segments.entries()) {
      checkSlot(segment, legend[i], layout[i], i);
    }
  }
});
