/**
 * Release feed, generated at build time from GitHub Releases (same data
 * as /changelog). Subscribers get every inup release with full notes.
 */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { renderReleaseNotes } from '../lib/release-notes';
import { site } from '../data/site';
import { stats } from '../lib/stats';
import { base } from '../lib/url';

export async function GET(context: APIContext) {
  return rss({
    title: 'inup releases',
    description: `New releases of ${site.tagline.toLowerCase()}.`,
    site: new URL(`${base}/`, context.site!).href,
    items: await Promise.all(
      stats.releases.map(async (r) => ({
        title: r.name === r.tag ? r.tag : `${r.tag} — ${r.name}`,
        link: r.url,
        pubDate: new Date(r.publishedAt),
        ...(r.body ? { content: await renderReleaseNotes(r.body) } : {}),
      })),
    ),
    customData: '<language>en</language>',
  });
}
