/**
 * The site's icon vocabulary, mapped to Iconify names. astro-icon inlines
 * each SVG at build time — no icon font, no CDN, no client requests.
 *
 * Lucide covers the UI set. The one brand mark we use is vendored into
 * `src/icons/` (astro-icon's local collection, referenced without a
 * prefix) rather than pulled from `@iconify-json/simple-icons`, which
 * shipped 4.7 MB of icon data for this single glyph. Simple Icons is
 * CC0-1.0, so the copy carries no attribution requirement.
 */
export const iconNames = {
  check: 'lucide:check',
  x: 'lucide:x',
  terminal: 'lucide:terminal',
  'shield-check': 'lucide:shield-check',
  'book-open': 'lucide:book-open',
  search: 'lucide:search',
  sliders: 'lucide:sliders-horizontal',
  'list-checks': 'lucide:list-checks',
  'arrow-left-right': 'lucide:arrow-left-right',
  'arrow-left': 'lucide:arrow-left',
  'arrow-right': 'lucide:arrow-right',
  'git-branch': 'lucide:git-branch',
  workflow: 'lucide:workflow',
  lock: 'lucide:lock',
  star: 'lucide:star',
  download: 'lucide:download',
  'arrow-up-right': 'lucide:arrow-up-right',
  keyboard: 'lucide:keyboard',
  zap: 'lucide:zap',
  scale: 'lucide:scale',
  github: 'github',
  rss: 'lucide:rss',
  sun: 'lucide:sun',
  moon: 'lucide:moon',
  copy: 'lucide:copy',
  menu: 'lucide:menu',
} as const;

export type IconName = keyof typeof iconNames;
