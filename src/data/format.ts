// Display formats. An ISO day or YYYY-MM is midnight UTC, so read it in UTC; 'en', because Node's
// en-GB writes "Sept".
const utc = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' });
const short = utc({ month: 'short' });
const shortYear = utc({ month: 'short', year: '2-digit' });
const long = utc({ month: 'long', year: 'numeric' });
const longDay = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

// "Sep ’26": the elision marked, so "Sep 26" does not read as a day of the month.
export const monthYear = (value: string) =>
  shortYear.format(new Date(value)).replace(/ (?=\d\d$)/, ' ’');
// "September 2026"
export const month = (value: string) => long.format(new Date(value));
// "10 Oct"
export const dayMonth = (value: string) => {
  const date = new Date(value);
  return `${date.getUTCDate()} ${short.format(date)}`;
};
// "10 Oct 2026"
export const day = (value: string) => `${dayMonth(value)} ${new Date(value).getUTCFullYear()}`;
// "10 October 2026"
export const fullDay = (value: string) => longDay.format(new Date(value));

// A row's tile: the initials of the first two words, or the first two letters of one word.
// Punctuation is not a word: "search (driceroland)" is "sd".
export const initials = (text: string) => {
  const [first = text, second] = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (second ? first[0] + second[0] : first.slice(0, 2)).toLowerCase();
};
