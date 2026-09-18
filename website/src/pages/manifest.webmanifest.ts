/**
 * Web app manifest, generated so every path derives from BASE_URL —
 * a custom-domain move can never leave stale hardcoded /inup/ paths.
 */
import { base } from '../lib/url';
import { site } from '../data/site';

export function GET() {
  const manifest = {
    name: `${site.name} — interactive dependency upgrader`,
    short_name: site.name,
    description: site.description,
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'browser',
    background_color: '#0b1120',
    theme_color: '#0b1120',
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}
