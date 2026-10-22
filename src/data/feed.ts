// /feed.xml's RSS 2.0 (FR-DS-1), written out here: every value needs only XML's escapes, and
// @astrojs/rss would add a package (NFR-M2) to format the same few elements.

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

// A URL attribute as a browser reads it. With a ";": numeric references and the five names Astro
// writes. Without one, HTML reads "&" and a name in an attribute only when the name is exactly one
// of its legacy entities below and no "=" follows, so a query string's &utm_source=x or &b=2
// stays as written; of those, amp, lt, gt and quot are read here. Any other reference fails the
// build rather than being guessed, as the gate's readers do (S29), and so do the numeric ones HTML
// replaces instead of decoding (0, 0x80–0x9F, surrogates, past U+10FFFF).
const legacy = new Set(
  'AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml'.split(
    ' ',
  ),
);
const names = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);
const replaced = (point: number) =>
  point === 0 ||
  (point >= 0x80 && point <= 0x9f) ||
  (point >= 0xd800 && point <= 0xdfff) ||
  point > 0x10ffff;
// The character a numeric reference ("#47", "#x2F") stands for, unless HTML replaces it.
const numeric = (body: string) => {
  const [, decimal, hex] = /^#(?:(\d+)|x([\da-f]+))$/i.exec(body) ?? [];
  const point = decimal ? Number(decimal) : Number.parseInt(hex, 16);
  return (decimal || hex) && !replaced(point) ? String.fromCodePoint(point) : undefined;
};
const decode = (value: string) =>
  value.replace(/&(#?[\da-z]*)(;?)/gi, (reference, body: string, semicolon: string, at: number) => {
    const unread =
      !semicolon && body[0] !== '#' && (!legacy.has(body) || value[at + reference.length] === '=');
    if (unread) {
      return reference;
    }
    const character = semicolon ? (numeric(body) ?? names.get(body)) : names.get(body);
    if (character === undefined || (!semicolon && body === 'apos')) {
      throw new Error(`a character reference the feed cannot read: ${reference}`);
    }
    return character;
  });

// The elements a body may use: those Markdown writes (code blocks, footnotes and task lists
// included) and plain raw HTML, all read by the same rules. Any other fails the build, as do
// "<!" other than a comment, "<?", and a tag none of the patterns below can read.
// ponytail: no <svg>, <math>, <iframe>, <script>, <style>, <textarea>, <video> and the like: HTML
// reads their insides or their URLs by other rules. Add a reader when a post first needs one.
const allowed =
  /^(?:a|abbr|b|blockquote|br|caption|cite|code|col|colgroup|dd|del|details|dfn|div|dl|dt|em|figcaption|figure|h[1-6]|hr|i|img|input|ins|kbd|li|mark|ol|p|pre|q|s|samp|section|small|span|strong|sub|summary|sup|t(?:able|body|d|foot|h|head|ime|r)|u|ul|var|wbr)$/i;
// Start tags as HTML's tokenizer reads them: ASCII whitespace only (a no-break space belongs to
// a bare value); a name runs to whitespace, "/", ">" or "="; a value is double-quoted,
// single-quoted, bare up to whitespace or ">", or empty right before ">"; a quote counts only
// right after "=". So a tag ends where a browser ends it, and each attribute is read whole.
// ponytail: a name may not start with "=" (an HTML parse error), so no pattern can split one
// name or value into two and every match is linear; such a tag fails the build.
const name = String.raw`[^\t\n\f\r />=]+(?=[\t\n\f\r />=])`;
const value = String.raw`[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r >"'][^\t\n\f\r >]*(?=[\t\n\f\r >])|(?=>))`;
// A comment (to the body's end if unclosed, as in HTML), a start tag (its name in group 1), a
// plain end tag, or, last, any other "<!", "<?", "</" or "<" and a letter (group 2).
const markup = new RegExp(
  String.raw`<!--(?:-?>|[\s\S]*?--!?>|[\s\S]*)|<([a-z][^\t\n\f\r />]*)(?=[\t\n\f\r />])(?:[\t\n\f\r /]*${name}(?:${value})?)*[\t\n\f\r /]*>|<\/[a-z][^\t\n\f\r />]*[\t\n\f\r ]*>|(<[!?/a-z])`,
  'gi',
);
// One attribute after the tag's name: what precedes it, its name, and its value as written.
const attribute = new RegExp(String.raw`([\t\n\f\r /]*)(${name})(${value})?`, 'gy');
// URL attributes other than href and src fail the build rather than stay relative.
const unresolved = /^(?:srcset|cite|ping|longdesc|background|itemid|itemtype)$/i;

// A reader resolves a body's links against the feed's URL, or not at all, so every href and src
// whose target depends on the page is resolved against the piece's page: a footnote's #fn-1, a
// root-relative /now, even "https:../b". One that resolves alike against another page, such as
// https://example.com/ or mailto:, stays exactly as written.
const elsewhere = 'http://elsewhere.invalid/';
const link = (page: string, whole: string, before: string, name: string, assigned = '') => {
  const key = name.toLowerCase();
  if (unresolved.test(key)) {
    throw new Error(`a URL attribute the feed cannot resolve: ${whole}`);
  }
  // The value as written, unquoted; a bare name is "", as in HTML.
  const written = assigned.replace(/^[\t\n\f\r ]*=[\t\n\f\r ]*/, '');
  const value = /^["']/.test(written) ? written.slice(1, -1) : written;
  if (key !== 'href' && key !== 'src') {
    return whole;
  }
  // Decoded first, so a reference cannot hide a "/" that makes the target depend on the page.
  const url = decode(value);
  if (new URL(url, page).href === new URL(url, elsewhere).href) {
    return whole;
  }
  const resolved = new URL(url, page).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `${before}${name}="${resolved}"`;
};
export const absolute = (html: string, page: string) => {
  // HTML turns a NUL into U+FFFD by rules that depend on where it stands; XML cannot carry it.
  if (html.includes('\0')) {
    throw new Error('a NUL character, which the feed cannot carry');
  }
  return html.replace(markup, (found, element?: string, unread?: string, at = 0) => {
    if (unread || (element && !allowed.test(element))) {
      throw new Error(`a tag the feed cannot read: ${html.slice(at, at + 80)}`);
    }
    if (!element) {
      return found;
    }
    return (
      found.slice(0, element.length + 1) +
      found
        .slice(element.length + 1)
        .replace(attribute, (whole, before: string, name: string, assigned?: string) =>
          link(page, whole, before, name, assigned),
        )
    );
  });
};

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
