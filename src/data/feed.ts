// /feed.xml's RSS 2.0, written out here: every value needs only XML's escapes, and @astrojs/rss
// would add a package to format the same few elements.

type Channel = { title: string; link: string; description: string; self: string };
type Item = { title: string; link: string; published: string; summary: string; html: string };

// XML 1.0 cannot carry most control characters, escaped or not, and discourages the rest and the
// noncharacters; a YAML "\x01" in a title would break the feed for every reader.
const unwritable = /(?![\t\n\r])[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]/u;

// Element text and double-quoted attribute values; "'" is fine as written in both.
const xml = (value: string) => {
  const [character] = unwritable.exec(value) ?? [];
  if (character !== undefined) {
    const point = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0');
    throw new Error(`a character XML cannot carry, U+${point}`);
  }
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
};

// A reader resolves a body's links against the feed's URL, or not at all, so every href and src
// whose target depends on the page is resolved against the piece's page: a footnote's #fn-1, a
// root-relative /now. One that resolves alike against another page, such as https://example.com/
// or mailto:, stays as written. Only tags are read, so code that shows an href is left alone.
// shortcut: reads double-quoted values with &amp; and &quot;, as Astro writes them; raw HTML with
// other quoting or references stays relative. Read the value as HTML does if a post needs that.
const tag = /<[a-z](?:"[^"]*"|'[^']*'|[^"'>])*>/gi;
const url = /(\s(?:href|src)=)"([^"]*)"/gi;
const elsewhere = 'http://elsewhere.invalid/';
export const absolute = (html: string, page: string) =>
  html.replace(tag, (found) =>
    found.replace(url, (whole, name: string, value: string) => {
      const target = value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
      const resolved = new URL(target, page).href;
      return resolved === new URL(target, elsewhere).href
        ? whole
        : `${name}"${resolved.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
    }),
  );

// One <item>. The endpoint makes each inside its own try, so an error names the piece's file.
export const item = ({ title, link, published, summary, html }: Item) => `<item>
<title>${xml(title)}</title>
<link>${xml(link)}</link>
<guid isPermaLink="true">${xml(link)}</guid>
<pubDate>${new Date(published).toUTCString()}</pubDate>
<description>${xml(summary)}</description>
<content:encoded>${xml(html)}</content:encoded>
</item>
`;

export const rss = ({ title, link, description, self }: Channel, items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${xml(title)}</title>
<link>${xml(link)}</link>
<description>${xml(description)}</description>
<language>en</language>
<atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>
${items.join('')}</channel>
</rss>
`;
