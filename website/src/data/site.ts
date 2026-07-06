/** Site-wide constants. Single source for names, URLs and metadata. */
export const site = {
  name: 'inup',
  tagline: 'Interactive dependency upgrader for npm, yarn, pnpm & bun',
  description:
    'Interactive dependency upgrader for npm, yarn, pnpm & bun. Zero-config, monorepo-ready. Upgrade-interactive for every package manager.',
  // Mirrors the npm package keywords (root package.json).
  keywords: [
    'upgrade-interactive',
    'interactive',
    'dependency-management',
    'outdated',
    'upgrade',
    'update',
    'npm',
    'yarn',
    'pnpm',
    'bun',
    'monorepo',
    'workspace',
    'cli',
    'vulnerability',
    'audit',
    'changelog',
    'package-manager',
    'dependencies',
    'semver',
    'ncu',
  ],
  /** Fallback when the npm registry is unreachable at build time. */
  lastKnownVersion: '1.6.7',
  nodeRequirement: '>=22.19.0',
  license: 'MIT',
  repoUrl: 'https://github.com/donfear/inup',
  npmUrl: 'https://www.npmjs.com/package/inup',
  issuesUrl: 'https://github.com/donfear/inup/issues',
  releasesUrl: 'https://github.com/donfear/inup/releases',
  actionDocsUrl: 'https://github.com/donfear/inup#github-action--one-rolling-upgrade-pr',
} as const;
