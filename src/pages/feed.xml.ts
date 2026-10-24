import { render } from 'astro:content';
import type { APIRoute } from 'astro';
import { experimental_AstroContainer } from 'astro/container';
import { absolute, item, rss } from '../data/feed';
import { site } from '../data/site';
import { intro, pieces } from '../data/writing';

// Every piece pieces() lists, so no draft outside astro dev, newest first, each
// with the whole body its page shows: render() and <Content />, as the page renders it, images
// included. astro/container renders a component to a string.
export const GET: APIRoute = async ({ site: origin }) => {
  const renderer = await experimental_AstroContainer.create();
  const url = (path: string) => new URL(path, origin).href;
  const items = [];
  for (const piece of await pieces()) {
    const link = url(`/writing/${piece.id}/`);
    try {
      const { Content } = await render(piece);
      const html = absolute(await renderer.renderToString(Content), link);
      items.push(item({ ...piece.data, link, html }));
    } catch (error) {
      throw new Error(`${piece.filePath}: ${(error as Error).message}`);
    }
  }
  const channel = {
    title: `writing · ${site.fullName}`,
    link: url('/writing/'),
    description: intro,
    self: url('/feed.xml'),
  };
  return new Response(rss(channel, items), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
