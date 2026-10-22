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
    ["<a title='x' href='/now'>", `<a title='x' href="${site}/now">`],
    ['<a href=/now>', `<a href="${site}/now">`],
    ['<a href = "/now">', `<a href="${site}/now">`],
    ['<a HREF="/now">', `<a HREF="${site}/now">`],
    ['<a href="&#x2F;now">', `<a href="${site}/now">`],
    ['<a href>', `<a href="${page}">`],
    [`<a href=a${String.fromCharCode(0xa0)}b>`, `<a href="${page}a%C2%A0b">`],
    ['<a href=/now?view=full>', `<a href="${site}/now?view=full">`],
    ['<a title="go"href="../b/">', `<a title="go"href="${site}/writing/b/">`],
    ['<a href="https:../b/">', `<a href="${site}/writing/b/">`],
    ['<a href=>', `<a href="${page}">`],
    ['<a b=x=y href="/now">', `<a b=x=y href="${site}/now">`],
    ['<a href="/a?b=1&c=2">', `<a href="${site}/a?b=1&amp;c=2">`],
    ['<a href="/a?q=1&redirect_uri=/b">', `<a href="${site}/a?q=1&amp;redirect_uri=/b">`],
    ['<a href="/a?b&amp">', `<a href="${site}/a?b&amp;">`],
  ]) {
    assert.equal(absolute(html, page), expected);
  }
});

test('absolute() reads attribute names only, never inside a value or comment', () => {
  for (const html of [
    '<a href="https://example.com/?a=1&amp;b=2">x</a>',
    '<a href="https://example.com/?a=1&b=2">x</a>',
    '<a href="mailto:x@example.com">m</a>',
    '<a href="https://example.com/?q=one&utm_source=news">s</a>',
    '<code>&lt;a href="/y"&gt;</code> a &lt; b',
    '<!-- <a href="/x"> -->',
    '<!--> <a href="https://example.com/">',
    '<p>a draft <!-- <a href="/x">',
    '<br/><hr>',
  ]) {
    assert.equal(absolute(html, page), html);
  }
  assert.equal(
    absolute('<a href="/now" title="Example href=/sample">', page),
    `<a href="${site}/now" title="Example href=/sample">`,
  );
  assert.equal(
    absolute(`<a title='Example href="/b"' href="/now">`, page),
    `<a title='Example href="/b"' href="${site}/now">`,
  );
  assert.equal(
    absolute('<img alt="see src= here, a srcset= b" src="/a.webp">', page),
    `<img alt="see src= here, a srcset= b" src="${site}/a.webp">`,
  );
});

test('absolute() fails on what it cannot read', () => {
  for (const html of [
    '<img srcset="/a.webp 1x">',
    '<a href="&sol;now">',
    '<a href="https:vedaantrajoo.com/a&sol;b/../../../../now">',
    '<a href="/a?b&not">',
    '<a href="/now?q=&#x80;">',
    '<a href="/now?q=&#0;">',
    '<a href="/now?q=&#xD800;">',
    '<a href="/now?q=&#x110000;">',
    '<a =x href="/now">',
    '<a href="/now" title="x',
    `<a b=${'x='.repeat(25000)}`,
    `<a${'b'.repeat(25000)}`,
    `<script>const a = '<a href="/x">';</script>`,
    '<textarea><a href="/now">sample</a></textarea>',
    '<p>x<title>t</title>',
    '<iframe src="../demo/"></iframe>',
    '<svg><a href="../b/"><text>b</text></a></svg>',
    '<p><![CDATA[x]]></p>',
    '<?x?>',
    '</a title=">">',
    '<blockquote cite="/source">',
    `<a href="/x${String.fromCharCode(0)}y">`,
  ]) {
    assert.throws(() => absolute(html, page));
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
