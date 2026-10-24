import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absolute, item, rss } from './feed';

const page = 'https://vedaantrajoo.com/writing/a/';
const site = 'https://vedaantrajoo.com';

test('absolute() resolves every href and src that depends on the page against it', () => {
  for (const [html, expected] of [
    ['<a href="#fn-1" id="r">', `<a href="${page}#fn-1" id="r">`],
    ['<a href="/now">', `<a href="${site}/now">`],
    ['<img alt="a>b" src="/_astro/a.webp">', `<img alt="a>b" src="${site}/_astro/a.webp">`],
    ['<a href="x.html">', `<a href="${page}x.html">`],
    ['<a href="../b/?q=1&amp;r=2">', `<a href="${site}/writing/b/?q=1&amp;r=2">`],
    ['<a href="//example.com/p">', '<a href="https://example.com/p">'],
    ['<a HREF="/now">', `<a HREF="${site}/now">`],
  ]) {
    assert.equal(absolute(html, page), expected);
  }
});

test('absolute() leaves links that resolve alike, and text outside tags', () => {
  for (const html of [
    '<a href="https://example.com/?a=1&amp;b=2">x</a>',
    '<a href="mailto:x@example.com">m</a>',
    '<code>&lt;a href="/y"&gt;</code> a &lt; b',
    '<a title="Example href=/sample" data-src="/b">',
    '<br/><hr>',
  ]) {
    assert.equal(absolute(html, page), html);
  }
});

test('item() escapes every value and refuses a character XML cannot carry', () => {
  const fields = {
    title: 'T & "t"',
    link: 'https://e.example/w/b/',
    published: '2026-08-05',
    summary: "<s>' ]]>",
    html: '<p>&amp;\tx\n</p>',
  };
  const xml = item(fields);
  for (const part of [
    '<title>T &amp; &quot;t&quot;</title>',
    '<link>https://e.example/w/b/</link>',
    '<guid isPermaLink="true">https://e.example/w/b/</guid>',
    '<pubDate>Wed, 05 Aug 2026 00:00:00 GMT</pubDate>',
    "<description>&lt;s&gt;' ]]&gt;</description>",
    '<content:encoded>&lt;p&gt;&amp;amp;\tx\n&lt;/p&gt;</content:encoded>',
  ]) {
    assert.ok(xml.includes(part), part);
  }
  for (const code of [1, 0xd800, 0xfffe]) {
    assert.throws(() => item({ ...fields, title: `a${String.fromCharCode(code)}b` }), /U\+/);
  }
});

test('rss() puts the items in a channel, in order, and is the channel alone with none', () => {
  const channel = {
    title: 'a & <b>',
    link: 'https://e.example/w/',
    description: '"d"',
    self: 'https://e.example/feed.xml',
  };
  const self =
    '<atom:link href="https://e.example/feed.xml" rel="self" type="application/rss+xml"/>';
  const xml = rss(channel, ['<item>1</item>\n', '<item>2</item>\n']);
  for (const part of [
    '<title>a &amp; &lt;b&gt;</title>',
    '<link>https://e.example/w/</link>',
    '<description>&quot;d&quot;</description>',
    `${self}\n<item>1</item>\n<item>2</item>\n</channel>\n</rss>\n`,
  ]) {
    assert.ok(xml.includes(part), part);
  }
  assert.ok(rss(channel, []).endsWith(`${self}\n</channel>\n</rss>\n`));
});
