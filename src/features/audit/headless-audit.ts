import * as semver from 'semver'
import type { PackageInfo, VulnerabilitySeverity } from '../../shared/types'
import { fetchVulnerabilities, VulnerabilityInfo } from './vulnerability-checker'
import { toComparableVersion } from '../../shared/versions'
import type { HeadlessAdvisory, HeadlessVulnerability } from './types'

/**
 * Audit the outdated packages' currently-installed versions (one bulk request, matching the
 * interactive audit) and, for each advisory, cross-reference its affected range against the
 * upgrade targets — so callers can state whether upgrading actually *fixes* the issue.
 *
 * Best-effort: `fetchVulnerabilities` swallows network errors and returns an empty map, so a
 * failed audit never blocks the report. Returns only the vulnerable packages, keyed by package.
 */
export async function auditVulnerabilities(
  outdated: PackageInfo[]
): Promise<Map<PackageInfo, HeadlessVulnerability>> {
  const result = new Map<PackageInfo, HeadlessVulnerability>()
  if (outdated.length === 0) return result

  // The bulk advisory API is keyed by package name (one version per name), so dedupe by name.
  const versions = new Map<string, string>()
  for (const pkg of outdated) {
    if (!versions.has(pkg.name)) versions.set(pkg.name, pkg.currentVersion)
  }

  const advisories = await fetchVulnerabilities(versions)
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
  if (semver.validRange(vulnerableVersions) === null) return false
  try {
    return !semver.satisfies(comparable, vulnerableVersions, { includePrerelease: true })
  } catch {
    return false
  }
}
