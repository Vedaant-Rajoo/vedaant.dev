// "Sep ’26": p09's "Mon YY" with the year's elision marked, so "Sep 26" does not read as a day of
// the month. An ISO day or YYYY-MM is midnight UTC, so format in UTC; 'en', because Node's en-GB
// writes "Sept".
const format = new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const monthYear = (value: string) =>
  format.format(new Date(value)).replace(/ (?=\d\d$)/, ' ’');
