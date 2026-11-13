// Display formats. An ISO day or YYYY-MM is midnight UTC, so read it in UTC; 'en', because Node's
// en-GB writes "Sept".
// 'en' short month names, as Intl writes them, spelled out so /shelf's script needs no formatter;
// the formatter is marked pure, so a script that uses no long date leaves it out.
const short = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const longDay = /* @__PURE__ */ new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

// "Sep ’26": the elision marked, so "Sep 26" does not read as a day of the month.
export const monthYear = (value: string) => {
  const date = new Date(value);
  return `${short[date.getUTCMonth()]} ’${String(date.getUTCFullYear()).slice(-2)}`;
};
// "10 Oct"
export const dayMonth = (value: string) => {
  const date = new Date(value);
  return `${date.getUTCDate()} ${short[date.getUTCMonth()]}`;
};
// "10 Oct 2026"
export const day = (value: string) => `${dayMonth(value)} ${new Date(value).getUTCFullYear()}`;
// "10 October 2026"
export const fullDay = (value: string) => longDay.format(new Date(value));
// "September 2026": a month's first whole day without its "1 ", so a page that also writes whole
// days needs one formatter.
export const month = (value: string) => fullDay(value.slice(0, 7)).slice(2);

// A row's tile: the initials of the first two words, or the first two letters of one word.
// Punctuation is not a word: "search (driceroland)" is "sd".
export const initials = (text: string) => {
  const [first = text, second] = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (second ? first[0] + second[0] : first.slice(0, 2)).toLowerCase();
};
