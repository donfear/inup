import type { PackageInfo } from '../../shared/types'
import { HEADLESS_SCHEMA_VERSION, HeadlessReport, HeadlessReportEntry } from './types'
import { HeadlessVulnerability } from '../audit'

type VulnerabilityMap = Map<PackageInfo, HeadlessVulnerability>

/** Build the machine-readable `--json` payload from the scanned + outdated package sets. */
export function buildHeadlessReport(
  all: PackageInfo[],
  outdated: PackageInfo[],
  vulnerabilities: VulnerabilityMap
): HeadlessReport {
  return {
    schemaVersion: HEADLESS_SCHEMA_VERSION,
    summary: {
      total: all.length,
      outdated: outdated.length,
      major: outdated.filter((pkg) => pkg.hasMajorUpdate).length,
      vulnerable: vulnerabilities.size,
    },
    outdated: outdated.map((pkg) => {
      const entry: HeadlessReportEntry = {
        name: pkg.name,
        current: pkg.currentVersion,
        range: pkg.rangeVersion,
        latest: pkg.latestVersion,
        type: pkg.type,
        packageJsonPath: pkg.packageJsonPath,
        hasMajorUpdate: pkg.hasMajorUpdate,
      }
      if (pkg.catalog) entry.catalog = pkg.catalog
      if (pkg.deprecated) entry.deprecated = pkg.deprecated
      if (pkg.enginesNode) entry.enginesNode = pkg.enginesNode
      const vulnerability = vulnerabilities.get(pkg)
      if (vulnerability) entry.vulnerability = vulnerability
      return entry
    }),
  }
}

/** Render the plain, line-based report (one line per package + a recap) as a single string. */
export function renderPlainReport(
  outdated: PackageInfo[],
  vulnerabilities: VulnerabilityMap
): string {
  if (outdated.length === 0) {
    return 'All dependencies are up to date — no upgrades needed.'
  }

  const lines = outdated.map((pkg) => {
    const major = pkg.hasMajorUpdate ? ' (major)' : ''
    const deprecated = pkg.deprecated ? '  [deprecated]' : ''
    return `${pkg.name}  ${pkg.currentVersion} → ${pkg.latestVersion}  [${pkg.type}]${major}${vulnMarker(vulnerabilities.get(pkg))}${deprecated}`
  })

  const fileCount = new Set(outdated.map((pkg) => pkg.packageJsonPath)).size
  const vulnNote =
    vulnerabilities.size > 0 ? ` — ${vulnerabilities.size} with known vulnerabilities` : ''
  lines.push('', `${outdated.length} package(s) outdated across ${fileCount} file(s)${vulnNote}.`)
  return lines.join('\n')
}

/** A compact `[vuln: N sev → verdict]` tag for the plain report; '' when there are none. */
function vulnMarker(vulnerability: HeadlessVulnerability | undefined): string {
  if (!vulnerability) return ''
  // Prefer the cheaper fix: if the in-range bump already clears it, that's the safer action.
  const verdict = vulnerability.fixedByRange
    ? 'fixed by range upgrade'
    : vulnerability.fixedByLatest
      ? 'fixed by latest only'
      : 'not fixed by upgrade'
  return `  [vuln: ${vulnerability.count} ${vulnerability.highestSeverity} → ${verdict}]`
}
