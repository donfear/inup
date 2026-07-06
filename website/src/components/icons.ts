/**
 * The site's icon vocabulary, mapped to Iconify names (Lucide for UI,
 * Simple Icons for brand marks). astro-icon inlines each SVG at build
 * time — no icon font, no CDN, no client requests.
 */
export const iconNames = {
  check: 'lucide:check',
  x: 'lucide:x',
  minus: 'lucide:minus',
  terminal: 'lucide:terminal',
  'shield-check': 'lucide:shield-check',
  'book-open': 'lucide:book-open',
  search: 'lucide:search',
  sliders: 'lucide:sliders-horizontal',
  'list-checks': 'lucide:list-checks',
  'arrow-left-right': 'lucide:arrow-left-right',
  'git-branch': 'lucide:git-branch',
  workflow: 'lucide:workflow',
  lock: 'lucide:lock',
  package: 'lucide:package',
  star: 'lucide:star',
  download: 'lucide:download',
  'arrow-up-right': 'lucide:arrow-up-right',
  keyboard: 'lucide:keyboard',
  'file-text': 'lucide:file-text',
  zap: 'lucide:zap',
  scale: 'lucide:scale',
  github: 'simple-icons:github',
  rss: 'lucide:rss',
  sun: 'lucide:sun',
  moon: 'lucide:moon',
} as const;

export type IconName = keyof typeof iconNames;
