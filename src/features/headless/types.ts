import type { DependencyType, VulnerabilitySeverity } from '../../types'

export interface HeadlessOptions {
  json?: boolean // Emit a machine-readable JSON report on stdout
  check?: boolean // Exit non-zero when updates exist (CI gate)
}

/** Bump when the `--json` shape changes in a way consumers (scripts, agents) must adapt to. */
export const HEADLESS_SCHEMA_VERSION = 1

export interface HeadlessAdvisory {
  id: number
  title: string
  severity: VulnerabilitySeverity
  url: string
  vulnerableVersions: string // The advisory's affected semver range, verbatim from npm
  fixedByRange: boolean // The in-range target (`range`) is no longer affected
  fixedByLatest: boolean // The latest target (`latest`) is no longer affected
}

export interface HeadlessVulnerability {
  count: number
  highestSeverity: VulnerabilitySeverity
  fixedByRange: boolean // Every advisory is cleared by upgrading within the current range
  fixedByLatest: boolean // Every advisory is cleared by upgrading to latest
  advisories: HeadlessAdvisory[]
}

export interface HeadlessReportEntry {
  name: string
  current: string // Raw specifier from package.json (with ^/~ prefix)
  range: string // Latest version satisfying the current range
  latest: string // Absolute latest version
  type: DependencyType
  packageJsonPath: string
  hasMajorUpdate: boolean
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
