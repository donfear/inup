import type { CooldownHold, DependencyType } from '../../shared/types'
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
export const HEADLESS_SCHEMA_VERSION = 2

/**
 * A package the release-age cooldown withheld a version from.
 *
 * Reported at the top level rather than only inside `outdated`, because a package whose ONLY
 * newer versions are inside the cooldown window is not outdated — it would otherwise be
 * indistinguishable from a package that is genuinely up to date. Superset: packages that are
 * also outdated appear here AND carry `heldByCooldown` on their `outdated` entry.
 */
export interface HeadlessCooldownHold extends CooldownHold {
  name: string
  type: DependencyType
  packageJsonPath: string
}

/**
 * A dependency whose registry lookup failed (network, auth, or not found), so nothing is known
 * about its updates. Listed so a failure is never read as "up to date" — both are absent from
 * `outdated`.
 */
export interface HeadlessFailedLookup {
  name: string
  current: string // Raw specifier from package.json (with ^/~ prefix)
  type: DependencyType
  packageJsonPath: string // pnpm-workspace.yaml for catalog entries
  catalog?: string // pnpm catalog the range is defined in ('default' or a named catalog)
}

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
  heldByCooldown?: CooldownHold // A newer version exists but minimumReleaseAge withheld it
}

export interface HeadlessReport {
  schemaVersion: number // HEADLESS_SCHEMA_VERSION — lets agents pin to a known shape
  summary: {
    total: number // Packages scanned
    outdated: number // Packages with an available update
    major: number // Of the outdated, how many have a latest beyond the in-range target
    vulnerable: number // Of the outdated, how many have ≥1 known advisory on the current version
    heldByCooldown: number // Packages with ≥1 version withheld by minimumReleaseAge (0 when disabled)
    failed: number // Packages whose registry lookup failed (unique names)
  }
  outdated: HeadlessReportEntry[]
  heldByCooldown: HeadlessCooldownHold[] // Every withheld package, outdated or not
  failed: HeadlessFailedLookup[] // One entry per location, like `outdated`
  cooldown?: HeadlessCooldownStatus // Present only when a release-age cooldown was configured
}

/**
 * Whether the configured cooldown could actually act.
 *
 * The policy fails open on missing publish times, so a registry that doesn't expose `time`
 * yields an empty `heldByCooldown` — byte-identical to "every version is old enough". Without
 * this, a consumer cannot tell a satisfied cooldown from an inert one, and would read a
 * disabled control as a passing check.
 */
export interface HeadlessCooldownStatus {
  minimumReleaseAge: number // The configured window, in minutes
  publishTimesAvailable: boolean // false = the registry returned no `time`; the cooldown did nothing
}
