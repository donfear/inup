import type { DependencyType } from '../../shared/types'
import type { HeadlessVulnerability } from '../audit'

/** Version policy for `--apply`: how far to bump. `minor`/`patch` stay in-range; `latest` allows majors. */
export type ApplyTarget = 'minor' | 'patch' | 'latest'

export interface HeadlessOptions {
  json?: boolean // Emit a machine-readable JSON report on stdout
  check?: boolean // Exit non-zero when updates exist (CI gate)
  apply?: boolean // Write the bumps to package.json + run install (the only write path)
  target?: ApplyTarget // --apply version policy; defaults to 'minor' (in-range only)
}

/** Bump when the `--json` shape changes in a way consumers (scripts, agents) must adapt to. */
export const HEADLESS_SCHEMA_VERSION = 1

export interface HeadlessReportEntry {
  name: string
  current: string // Raw specifier from package.json (with ^/~ prefix)
  range: string // Latest version satisfying the current range
  latest: string // Absolute latest version
  type: DependencyType
  packageJsonPath: string // pnpm-workspace.yaml for catalog entries
  catalog?: string // pnpm catalog the range is defined in ('default' or a named catalog)
  hasMajorUpdate: boolean
  majorIgnored?: boolean // Major update exists but .inuprc ignoreMajor suppresses it (hasMajorUpdate is false)
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
  vulnerability?: HeadlessVulnerability // Advisories on the current version + whether upgrading clears them
}

export interface HeadlessReport {
  schemaVersion: number // HEADLESS_SCHEMA_VERSION — lets agents pin to a known shape
  summary: {
    total: number // Packages scanned
    outdated: number // Packages with an available update
    major: number // Of the outdated, how many are a major bump
    vulnerable: number // Of the outdated, how many have ≥1 known advisory on the current version
  }
  outdated: HeadlessReportEntry[]
}
