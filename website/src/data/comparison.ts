/**
 * Single source of truth for every comparison table on the site.
 * The index renders a column subset; each vs/ page renders a two-column
 * slice plus rows unique to that head-to-head. Data verified against each
 * tool's documentation on 2026-07-06.
 */
export type Support = 'yes' | 'no' | 'na';
export type CompetitorId = 'ncu' | 'taze' | 'npm-check' | 'builtin';
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
};

export interface FeatureRow {
  feature: string;
  support: Partial<Record<ColumnId, Support>>;
  /** Shown in the homepage overview table (curated subset). */
  homepage?: boolean;
}

/**
 * The full matrix. A missing entry for a column means the row is not
 * relevant to that head-to-head and is skipped when slicing.
 */
export const rows: FeatureRow[] = [
  {
    feature: 'One tool for npm, yarn, pnpm & bun',
    homepage: true,
    support: { inup: 'yes', ncu: 'yes', taze: 'yes', 'npm-check': 'no', builtin: 'no' },
  },
  {
    feature: 'Interactive upgrade UI',
    support: { inup: 'yes', ncu: 'yes', taze: 'yes', 'npm-check': 'yes', builtin: 'yes' },
  },
  {
    feature: 'Monorepos & workspaces',
    homepage: true,
    support: { inup: 'yes', ncu: 'yes', taze: 'yes', 'npm-check': 'no', builtin: 'yes' },
  },
  {
    feature: 'Vulnerability audit in the picker',
    homepage: true,
    support: { inup: 'yes', ncu: 'no', taze: 'no', 'npm-check': 'no', builtin: 'no' },
  },
  {
    feature: 'Changelogs in the terminal',
    homepage: true,
    support: { inup: 'yes', ncu: 'no', taze: 'no', 'npm-check': 'no', builtin: 'no' },
  },
  {
    feature: 'Search & dep-type toggles in the UI',
    homepage: true,
    support: { inup: 'yes', ncu: 'no', taze: 'no', 'npm-check': 'no', builtin: 'no' },
  },
  {
    feature: 'pnpm catalogs, comments preserved',
    homepage: true,
    support: { inup: 'yes', ncu: 'no', taze: 'yes', builtin: 'no' },
  },
  {
    feature: 'CI gate + JSON report',
    homepage: true,
    support: { inup: 'yes', ncu: 'yes', taze: 'no', 'npm-check': 'no', builtin: 'no' },
  },
  {
    feature: 'GitHub Action included',
    support: { inup: 'yes', ncu: 'no', taze: 'no', 'npm-check': 'no', builtin: 'no' },
  },
  {
    feature: 'Actively maintained (2026)',
    support: { inup: 'yes', ncu: 'yes', taze: 'yes', 'npm-check': 'no', builtin: 'yes' },
  },
  {
    feature: 'Doctor mode (test each upgrade)',
    homepage: true,
    support: { inup: 'no', ncu: 'yes', taze: 'no', builtin: 'no' },
  },
  {
    feature: 'Cooldown / publish-age delay',
    support: { inup: 'no', ncu: 'yes' },
  },
  {
    feature: 'Per-package upgrade rules',
    homepage: true,
    support: { inup: 'no', ncu: 'yes', taze: 'yes', builtin: 'no' },
  },
  {
    feature: 'Config file with typed defineConfig',
    support: { inup: 'no', taze: 'yes' },
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
    support: { inup: 'no', 'npm-check': 'yes' },
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
