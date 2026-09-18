import { countHeldPackages, packagesWithHolds } from '../../shared/cooldown'
import { formatAge } from '../../shared/duration'
import type { CooldownHold, PackageInfo } from '../../shared/types'
import type { HeadlessVulnerability } from '../audit'
import {
  HEADLESS_SCHEMA_VERSION,
  type HeadlessCooldownHold,
  type HeadlessCooldownStatus,
  type HeadlessReport,
  type HeadlessReportEntry,
} from './types'

type VulnerabilityMap = Map<PackageInfo, HeadlessVulnerability>

/** Build the machine-readable `--json` payload from the scanned + outdated package sets. */
export function buildHeadlessReport(
  all: PackageInfo[],
  outdated: PackageInfo[],
  vulnerabilities: VulnerabilityMap,
  cooldown?: HeadlessCooldownStatus | null
): HeadlessReport {
  // Drawn from `all`, not `outdated`: a package whose only newer versions are inside the
  // cooldown window is not outdated, and is precisely the case that must stay visible.
  // One entry per location, matching `outdated` — the same package held in five workspaces
  // is five rows, because each names a different file.
  const held: HeadlessCooldownHold[] = packagesWithHolds(all).map((pkg) => ({
    name: pkg.name,
    type: pkg.type,
    packageJsonPath: pkg.packageJsonPath,
    ...pkg.heldByCooldown,
  }))

  return {
    schemaVersion: HEADLESS_SCHEMA_VERSION,
    summary: {
      total: all.length,
      outdated: outdated.length,
      major: outdated.filter((pkg) => pkg.hasMajorUpdate).length,
      vulnerable: vulnerabilities.size,
      // Unique packages, NOT array length: this is a risk count, and one package
      // held across five workspaces is one thing to think about, not five.
      heldByCooldown: countHeldPackages(all),
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
      if (pkg.majorIgnored) entry.majorIgnored = true
      if (pkg.catalog) entry.catalog = pkg.catalog
      if (pkg.deprecated) entry.deprecated = pkg.deprecated
      if (pkg.enginesNode) entry.enginesNode = pkg.enginesNode
      if (pkg.heldByCooldown) entry.heldByCooldown = pkg.heldByCooldown
      const vulnerability = vulnerabilities.get(pkg)
      if (vulnerability) entry.vulnerability = vulnerability
      return entry
    }),
    heldByCooldown: held,
    ...(cooldown ? { cooldown } : {}),
  }
}

/** Render the plain, line-based report (one line per package + a recap) as a single string. */
export function renderPlainReport(
  outdated: PackageInfo[],
  vulnerabilities: VulnerabilityMap,
  all: PackageInfo[] = outdated
): string {
  const held = packagesWithHolds(all).map((pkg) => ({ name: pkg.name, hold: pkg.heldByCooldown }))

  if (outdated.length === 0) {
    // "Up to date" would be a lie while the cooldown is holding something back.
    return held.length === 0
      ? 'All dependencies are up to date — no upgrades needed.'
      : ['All dependencies are up to date — no upgrades needed.', '', ...heldLines(held)].join('\n')
  }

  const lines = outdated.map((pkg) => {
    const major = pkg.hasMajorUpdate ? ' (major)' : ''
    const deprecated = pkg.deprecated ? '  [deprecated]' : ''
    // With ignoreMajor in effect the actionable target is the in-range bump,
    // so the arrow points there instead of at the suppressed major.
    const displayTarget = pkg.majorIgnored ? pkg.rangeVersion : pkg.latestVersion
    return `${pkg.name}  ${pkg.currentVersion} → ${displayTarget}  [${pkg.type}]${major}${vulnMarker(vulnerabilities.get(pkg))}${deprecated}`
  })

  const fileCount = new Set(outdated.map((pkg) => pkg.packageJsonPath)).size
  const vulnNote =
    vulnerabilities.size > 0 ? ` — ${vulnerabilities.size} with known vulnerabilities` : ''
  lines.push('', `${outdated.length} package(s) outdated across ${fileCount} file(s)${vulnNote}.`)
  if (held.length > 0) lines.push('', ...heldLines(held))
  return lines.join('\n')
}

/**
 * The cooldown recap: what was withheld, so a held version is never silently missing.
 *
 * Collapsed to one line per (package, held version). A workspace repo carries one entry per
 * location, and the hold is a property of the published package, not of where it is depended
 * on — printing it once per workspace would be pure repetition.
 */
function heldLines(held: Array<{ name: string; hold: CooldownHold }>): string[] {
  const unique = new Map<string, { name: string; hold: CooldownHold }>()
  for (const entry of held) {
    const key = `${entry.name}@${entry.hold.version}`
    if (!unique.has(key)) unique.set(key, entry)
  }

  const lines = [`Held by release-age cooldown (${unique.size}):`]
  for (const { name, hold } of unique.values()) {
    const extra = hold.count > 1 ? ` (+${hold.count - 1} more)` : ''
    lines.push(`  ${name}  ${hold.version}  published ${formatAge(hold.ageMinutes)} ago${extra}`)
  }
  return lines
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
