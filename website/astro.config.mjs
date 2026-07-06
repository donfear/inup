import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// GitHub Pages project site: https://donfear.github.io/inup
// If a custom domain is added later, change `site` and drop `base`.
export default defineConfig({
  site: 'https://donfear.github.io',
  base: '/inup',
  integrations: [sitemap()],
});
