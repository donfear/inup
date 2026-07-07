/**
 * Site-wide constants. Package facts (version, description, keywords)
 * are imported from the tool's own package.json so they can never
 * drift from what ships to npm.
 */
import rootPkg from '../../../package.json';

const repoUrl = rootPkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

export const site = {
  name: rootPkg.name,
  tagline: 'Interactive dependency upgrader for npm, yarn, pnpm & bun',
  description: rootPkg.description,
  keywords: rootPkg.keywords,
  /** Fallback when the npm registry is unreachable at build time. */
  lastKnownVersion: rootPkg.version,
  nodeRequirement: rootPkg.engines.node,
  license: 'MIT',
  repoUrl,
  npmUrl: `https://www.npmjs.com/package/${rootPkg.name}`,
  issuesUrl: `${repoUrl}/issues`,
  releasesUrl: `${repoUrl}/releases`,
} as const;
