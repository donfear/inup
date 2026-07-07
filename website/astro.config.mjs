import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { satteri, satteriHeadingIdsPlugin } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import { defineConfig, fontProviders } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

const BASE = '/inup';

/**
 * Post-build gate for two whole-site invariants that are invisible in
 * source and easy to regress:
 *  - every absolute URL carries the GitHub Pages base path;
 *  - no text sits flush against an inline link (Astro drops newline-only
 *    whitespace between inline elements, gluing words like "see" + "the").
 */
const distAudits = {
  name: 'dist-audits',
  hooks: {
    'astro:build:done': ({ dir, logger }) => {
      const dist = fileURLToPath(dir);
      const failures = [];
      const htmlFiles = readdirSync(dist, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.html'));

      for (const file of htmlFiles) {
        const html = readFileSync(join(dist, file), 'utf8');
        for (const [, attr, url] of html.matchAll(/(href|src|content)="(\/[^"]*)"/g)) {
          if (!url.startsWith(`${BASE}/`) && url !== BASE && !url.startsWith('/#')) {
            failures.push(`${file}: ${attr}="${url}" is missing the ${BASE} base path`);
          }
        }
        for (const [glued] of html.matchAll(/[a-z]<a [^>]*>|<\/a>[a-zA-Z(]|[—·]<a /g)) {
          // Heading anchors are appended flush to the heading text on purpose.
          if (glued.includes('heading-anchor')) continue;
          failures.push(`${file}: text glued to a link (${glued.slice(0, 40)}…) — add {' '}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`dist audits failed:\n${failures.join('\n')}`);
      }
      logger.info(`audits passed on ${htmlFiles.length} pages (base paths, link spacing)`);
    },
  },
};

/** Append a "#" anchor link to docs headings (Sätteri hast plugin). */
const headingAnchorsPlugin = {
  name: 'heading-anchors',
  element: {
    filter: ['h2', 'h3'],
    visit(node, ctx) {
      const id = node.properties?.id;
      if (!id) return;
      ctx.appendChild(node, {
        type: 'element',
        tagName: 'a',
        properties: {
          href: `#${id}`,
          className: ['heading-anchor'],
          ariaLabel: 'Link to this section',
        },
        children: [{ type: 'text', value: '#' }],
      });
    },
  },
};

// GitHub Pages project site: https://donfear.github.io/inup
// If a custom domain is added later, change `site` and drop `base`/BASE —
// everything else (manifest included) derives from BASE_URL.
export default defineConfig({
  site: 'https://donfear.github.io',
  base: BASE,
  integrations: [sitemap(), icon(), distAudits],

  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Inter',
      cssVariable: '--font-inter',
      options: {
        variants: [
          {
            weight: '100 900',
            style: 'normal',
            src: ['./src/assets/fonts/inter-latin-wght-normal.woff2'],
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains-mono',
      options: {
        variants: [
          {
            weight: '100 800',
            style: 'normal',
            src: ['./src/assets/fonts/jetbrains-mono-latin-wght-normal.woff2'],
          },
        ],
      },
    },
  ],

  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        // -default variant: its comment color clears WCAG AA contrast,
        // plain github-dark's #6A737D does not.
        dark: 'github-dark-default',
      },
    },
    processor: satteri({
      // The heading-ids plugin is stateful (a slugger tracking seen ids),
      // so pass a factory: a shared instance would accumulate slugs across
      // documents and drift ids to `-1` suffixes between pages/reloads.
      // headingAnchorsPlugin is stateless and safe to share.
      hastPlugins: [() => satteriHeadingIdsPlugin(), headingAnchorsPlugin],
    }),
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
