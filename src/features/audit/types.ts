import type { VulnerabilitySeverity } from '../../shared/types'

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
