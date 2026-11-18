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
  // undefined when nothing matches, where the DOM gives null: the script tests ':hover' for it.
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0];
  }
}

type Mix = Element & {
  attributeChangedCallback(): void;
  connectedCallback(): void;
  onpointerleave(): void;
};

// The language-mix class from the component's real script, with `document` for its listeners.
function defineMix(document = {}) {
  const source = readFileSync('src/components/Coding.astro', 'utf8');
  const script = source.split('<script>')[1].split('</script>')[0];
  let Mix!: new () => Mix;
  runInNewContext(
    ts.transpile(script.slice(script.indexOf("customElements.define('language-mix'"))),
    {
      tag,
      document,
      HTMLElement: Element,
      customElements: {
        define: (_: string, element: typeof Mix) => {
          Mix = element;
        },
      },
    },
  );
  return Mix;
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
  const Mix = defineMix();
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

test('language mix closes its legend and quiets its tooltips as connectedCallback wires', () => {
  const listeners: Record<string, (event: { key?: string; target: Element }) => void> = {};
  const Mix = defineMix({
    addEventListener: (type: string, listener: (typeof listeners)[string]) => {
      listeners[type] = listener;
    },
  });
  let focused = false;
  const summary = Object.assign(new Element(), {
    focus: () => {
      focused = true;
    },
  });
  const row = new Element();
  const outside = new Element();
  const details = Object.assign(new Element({ summary: [summary] }), {
    open: true,
    contains: (node: Element) => node === summary || node === row,
  });
  const mix = new Mix();
  mix.children.details = [details];
  mix.connectedCallback();
  const press = (key: string, target: Element) => listeners.keydown({ key, target });

  // The open legend stays open for a click on a row and for Escape from outside it.
  listeners.click({ target: row });
  press('Escape', outside);
  assert.equal(details.open, true);
  // Escape from inside closes it and focuses the summary; a click outside closes it alone.
  press('Escape', summary);
  assert.deepEqual([details.open, focused], [false, true]);
  details.open = true;
  focused = false;
  listeners.click({ target: outside });
  assert.deepEqual([details.open, focused], [false, false]);

  // Escape quiets the tooltips only over a segment, until the pointer leaves the whole mix.
  press('Escape', outside);
  assert.equal(mix.getAttribute('data-quiet'), null);
  mix.children['[data-mix-segment]:hover'] = [new Element()];
  press('Enter', outside);
  assert.equal(mix.getAttribute('data-quiet'), null);
  press('Escape', outside);
  assert.equal(mix.getAttribute('data-quiet'), '');
  mix.onpointerleave();
  assert.equal(mix.getAttribute('data-quiet'), null);
});
