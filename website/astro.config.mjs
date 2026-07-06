import { satteri, satteriHeadingIdsPlugin } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import { defineConfig, fontProviders } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

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
// If a custom domain is added later, change `site`, drop `base`, and update
// the hardcoded /inup/ paths inside public/manifest.webmanifest.
export default defineConfig({
  site: 'https://donfear.github.io',
  base: '/inup',
  integrations: [sitemap(), icon()],

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
      hastPlugins: [satteriHeadingIdsPlugin(), headingAnchorsPlugin],
    }),
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
