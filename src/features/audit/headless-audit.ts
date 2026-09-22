import * as semver from 'semver'
import type { PackageInfo, VulnerabilitySeverity } from '../../shared/types'
import { toComparableVersion } from '../../shared/versions'
import type { HeadlessAdvisory, HeadlessVulnerability } from './types'
import type { PackageVulnerabilities, VulnerabilityInfo } from './vulnerability-checker'

/**
 * Cross-reference the advisories for the outdated packages' currently-installed versions against
 * the upgrade targets — so callers can state whether upgrading actually *fixes* the issue.
 *
 * `prefetched` is the bulk advisory request (`fetchVulnerabilities`), started by the caller from
 * the dependency set before the registry fetch so it overlaps instead of adding a round-trip.
 * Best-effort: that request swallows network errors and resolves to an empty map, so a failed
 * audit never blocks the report. Returns only the vulnerable packages, keyed by package.
 */
export async function auditVulnerabilities(
  outdated: PackageInfo[],
  prefetched: Promise<Map<string, PackageVulnerabilities>>
): Promise<Map<PackageInfo, HeadlessVulnerability>> {
  const result = new Map<PackageInfo, HeadlessVulnerability>()
  if (outdated.length === 0) return result

  const advisories = await prefetched
  if (advisories.size === 0) return result

  for (const pkg of outdated) {
    const found = advisories.get(pkg.name)
    if (!found || found.vulnerabilities.length === 0 || !found.highestSeverity) continue
    result.set(pkg, summarizeVulnerability(pkg, found.vulnerabilities, found.highestSeverity))
  }
  return result
}

function summarizeVulnerability(
  pkg: PackageInfo,
  vulnerabilities: VulnerabilityInfo[],
  highestSeverity: VulnerabilitySeverity
): HeadlessVulnerability {
  const advisories: HeadlessAdvisory[] = vulnerabilities.map((vuln) => ({
    id: vuln.id,
    title: vuln.title,
    severity: vuln.severity,
    url: vuln.url,
    vulnerableVersions: vuln.vulnerable_versions,
    fixedByRange: upgradeClears(pkg.rangeVersion, vuln.vulnerable_versions),
    fixedByLatest: upgradeClears(pkg.latestVersion, vuln.vulnerable_versions),
  }))

  return {
    count: advisories.length,
    highestSeverity,
    fixedByRange: advisories.every((advisory) => advisory.fixedByRange),
    fixedByLatest: advisories.every((advisory) => advisory.fixedByLatest),
    advisories,
  }
}

/**
 * True when upgrading to `target` escapes an advisory's affected range. Conservative: if either
 * the target or the advisory range can't be parsed, we do NOT claim a fix — `semver.satisfies`
 * treats an invalid range as "matches nothing", which would otherwise read as a false "fixed".
 */
export function upgradeClears(target: string, vulnerableVersions: string): boolean {
  const comparable = toComparableVersion(target)
  if (!comparable) return false
  // validRange rejects unparseable ranges above and comparable is a concrete
  // version, so satisfies() has valid inputs and never throws here.
  if (semver.validRange(vulnerableVersions) === null) return false
  return !semver.satisfies(comparable, vulnerableVersions, { includePrerelease: true })
}
