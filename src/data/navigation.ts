// The nav words, and home. Nav.astro links the words; the 404 page lists home and the words as
// rows, each with its tile and line.
export const home = {
  word: 'home',
  href: '/',
  tile: '/',
  sub: 'who I am, what I have built, what is on right now',
};

export const words = [
  {
    word: 'projects',
    href: '/projects',
    tile: 'pr',
    sub: 'things I built, and the decisions behind them',
  },
  { word: 'writing', href: '/writing', tile: 'wr', sub: 'posts and notes, dated' },
  { word: 'now', href: '/now', tile: 'nw', sub: 'what I am focused on at the moment' },
  {
    word: 'shelf',
    href: '/shelf',
    tile: 'sh',
    sub: 'albums, films and books, with a sentence each',
  },
];
