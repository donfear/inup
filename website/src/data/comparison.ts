/**
 * Single source of truth for every comparison table on the site.
 * The index renders a column subset; each vs/ page renders a two-column
 * slice plus rows unique to that head-to-head. A missing entry means the
 * row is not relevant to that head-to-head.
 */

/** The date every claim in this matrix was last checked against each tool's docs. */
export const verifiedOn = '2026-07-09';

export type Support = 'yes' | 'no';
export type CompetitorId =
  | 'ncu'
  | 'taze'
  | 'npm-check'
  | 'builtin'
  | 'renovate'
  | 'dependabot'
  | 'updates'
  | 'npm-upgrade';
export type ColumnId = 'inup' | CompetitorId;

export interface Competitor {
  id: CompetitorId;
  name: string;
  /** Short header label for tight tables. */
  short: string;
  url: string;
}

export const competitors: Record<CompetitorId, Competitor> = {
  ncu: {
    id: 'ncu',
    name: 'npm-check-updates',
    short: 'ncu',
    url: 'https://github.com/raineorshine/npm-check-updates',
  },
  taze: {
    id: 'taze',
    name: 'taze',
    short: 'taze',
    url: 'https://github.com/antfu-collective/taze',
  },
  'npm-check': {
    id: 'npm-check',
    name: 'npm-check',
    short: 'npm-check',
    url: 'https://github.com/dylang/npm-check',
  },
  builtin: {
    id: 'builtin',
    name: 'PM built-ins',
    short: 'PM built-ins',
    url: 'https://docs.npmjs.com/cli/commands/npm-update',
  },
  renovate: {
    id: 'renovate',
    name: 'Renovate',
    short: 'Renovate',
    url: 'https://github.com/renovatebot/renovate',
  },
  dependabot: {
    id: 'dependabot',
    name: 'Dependabot',
    short: 'Dependabot',
    url: 'https://github.com/dependabot/dependabot-core',
  },
  updates: {
    id: 'updates',
    name: 'updates',
    short: 'updates',
    url: 'https://github.com/silverwind/updates',
  },
  'npm-upgrade': {
    id: 'npm-upgrade',
    name: 'npm-upgrade',
    short: 'npm-upgrade',
    url: 'https://github.com/th0r/npm-upgrade',
  },
};

export interface FeatureRow {
  feature: string;
  support: Partial<Record<ColumnId, Support>>;
  /** Shown in the homepage overview table (curated subset). */
  homepage?: boolean;
}

/**
 * The full matrix. A missing entry for a column means the row is not
 * relevant to that head-to-head and is skipped when slicing. For the
 * always-on bots (Renovate, Dependabot) the picker-only rows are left
 * empty on purpose — they have no interactive picker — and their real
 * contrast lives in the automation rows further down.
 */
export const rows: FeatureRow[] = [
  {
    feature: 'One tool for npm, yarn, pnpm & bun',
    homepage: true,
    support: {
      inup: 'yes',
      ncu: 'yes',
      taze: 'yes',
      'npm-check': 'no',
      builtin: 'no',
      renovate: 'yes',
      dependabot: 'no',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'Interactive upgrade UI',
    support: {
      inup: 'yes',
      ncu: 'yes',
      taze: 'yes',
      'npm-check': 'yes',
      builtin: 'yes',
      updates: 'no',
      'npm-upgrade': 'yes',
    },
  },
  {
    feature: 'Monorepos & workspaces',
    homepage: true,
    support: {
      inup: 'yes',
      ncu: 'yes',
      taze: 'yes',
      'npm-check': 'no',
      builtin: 'yes',
      updates: 'yes',
      renovate: 'yes',
      dependabot: 'yes',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'Vulnerability audit in the picker',
    homepage: true,
    support: {
      inup: 'yes',
      ncu: 'no',
      taze: 'no',
      'npm-check': 'no',
      builtin: 'no',
      updates: 'no',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'Changelogs in the terminal',
    homepage: true,
    support: {
      inup: 'yes',
      ncu: 'no',
      taze: 'no',
      'npm-check': 'no',
      builtin: 'no',
      updates: 'no',
      'npm-upgrade': 'yes',
    },
  },
  {
    feature: 'Search & dep-type toggles in the UI',
    homepage: true,
    support: {
      inup: 'yes',
      ncu: 'no',
      taze: 'no',
      'npm-check': 'no',
      builtin: 'no',
      updates: 'no',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'pnpm catalogs, comments preserved',
    homepage: true,
    support: { inup: 'yes', ncu: 'no', taze: 'yes', builtin: 'no' },
  },
  {
    feature: 'CI gate + JSON report',
    homepage: true,
    support: {
      inup: 'yes',
      ncu: 'yes',
      taze: 'no',
      'npm-check': 'no',
      builtin: 'no',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'GitHub Action included',
    support: {
      inup: 'yes',
      ncu: 'no',
      taze: 'no',
      'npm-check': 'no',
      builtin: 'no',
      updates: 'no',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'Actively maintained (2026)',
    support: {
      inup: 'yes',
      ncu: 'yes',
      taze: 'yes',
      'npm-check': 'no',
      builtin: 'yes',
      updates: 'yes',
      renovate: 'yes',
      dependabot: 'yes',
      'npm-upgrade': 'yes',
    },
  },
  {
    feature: 'Doctor mode (test each upgrade)',
    homepage: true,
    support: { inup: 'no', ncu: 'yes', taze: 'no', builtin: 'no' },
  },
  {
    feature: 'Cooldown / publish-age delay',
    support: { inup: 'no', ncu: 'yes', taze: 'yes', updates: 'yes', renovate: 'yes' },
  },
  {
    feature: 'Per-package upgrade rules',
    homepage: true,
    support: {
      inup: 'no',
      ncu: 'yes',
      taze: 'yes',
      builtin: 'no',
      renovate: 'yes',
      dependabot: 'no',
      'npm-upgrade': 'no',
    },
  },
  {
    feature: 'Config file with typed defineConfig',
    support: { inup: 'no', taze: 'yes', updates: 'yes' },
  },
  {
    feature: 'Programmatic API',
    support: { inup: 'no', ncu: 'yes', taze: 'yes' },
  },
  {
    feature: 'Deno support',
    support: { inup: 'no', ncu: 'yes' },
  },
  {
    feature: 'Finds unused dependencies',
    support: { inup: 'no', 'npm-check': 'yes' },
  },
  {
    feature: 'Checks globally installed packages',
    support: { inup: 'no', ncu: 'yes', 'npm-check': 'yes', 'npm-upgrade': 'yes' },
  },
  {
    feature: 'Runs locally — no bot or hosted service',
    support: { inup: 'yes', renovate: 'no', dependabot: 'no' },
  },
  {
    feature: 'Interactive per-package choice before writing',
    support: {
      inup: 'yes',
      renovate: 'no',
      dependabot: 'no',
      updates: 'no',
      'npm-upgrade': 'yes',
    },
  },
  {
    feature: 'Automated PRs on a schedule',
    support: { inup: 'yes', renovate: 'yes', dependabot: 'yes' },
  },
  {
    feature: 'Auto-merge & grouping presets',
    support: { inup: 'no', renovate: 'yes', dependabot: 'yes' },
  },
  {
    feature: 'Updates non-JS ecosystems (Docker, CI, …)',
    support: { inup: 'no', updates: 'yes', renovate: 'yes', dependabot: 'yes' },
  },
];

/**
 * Rows where every requested column has data, in matrix order.
 * Rows where every requested column is 'no' carry no signal in a slice
 * (they only exist for other head-to-heads) and are dropped.
 */
export function rowsFor(columns: ColumnId[]): FeatureRow[] {
  return rows.filter(
    (r) =>
      columns.every((c) => r.support[c] !== undefined) &&
      columns.some((c) => r.support[c] !== 'no'),
  );
}
