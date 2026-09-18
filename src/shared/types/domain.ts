import type { ChalkInstance } from 'chalk'

export type VulnerabilitySeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical'

export interface VulnerabilitySummary {
  count: number
  highestSeverity: VulnerabilitySeverity
  detailsUrl?: string
  advisories: Array<{
    id: number
    title: string
    severity: VulnerabilitySeverity
    url: string
  }>
}

/**
 * Evidence that the release-age cooldown withheld one or more versions from this package.
 *
 * Present only when the cooldown actually changed what was on offer, so its presence alone
 * means "there is something newer that inup deliberately did not show you". Carried through
 * to the TUI badge, the --json report, and the GitHub Action PR body — a silent skip is
 * indistinguishable from being up to date, which is exactly the failure mode to avoid.
 */
export interface CooldownHold {
  version: string // Newest version withheld — what you would have been offered
  publishedAt: string // ISO publish time of that version
  ageMinutes: number // How old it was when the scan ran
  /**
   * Minutes until this version clears the window, as of the scan. Answers the question the
   * hold immediately raises — "so when can I have it?" — without the reader having to
   * subtract the age from a window they may not have configured themselves. Like
   * `ageMinutes`, it is a snapshot: it is measured against the clock at scan time.
   */
  eligibleInMinutes: number
  count: number // How many versions in total were withheld
}

export interface PackageInfo {
  name: string
  currentVersion: string // Raw version specifier from package.json (with ^/~ prefixes)
  rangeVersion: string // Version that satisfies current range
  latestVersion: string // Absolute latest version
  type: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
  packageJsonPath: string // Path to the package.json file (pnpm-workspace.yaml for catalog entries)
  catalog?: string // pnpm catalog the range is defined in ('default' or a named catalog)
  catalogEntries?: CatalogEntrySummary[] // Full contents of that catalog (for the info modal)
  catalogReferencedBy?: string[] // package.json paths that reference this catalog entry
  isOutdated: boolean
  hasRangeUpdate: boolean // If range version is different from current
  hasMajorUpdate: boolean // If latest version is a major update
  majorIgnored?: boolean // Major update exists but is suppressed by .inuprc ignoreMajor
  description?: string // Package description from npm registry
  homepage?: string // Package homepage URL
  repository?: string // GitHub/repository URL for releases
  weeklyDownloads?: number // Weekly download count from npm
  author?: string // Package author
  license?: string // Package license
  deprecated?: string // npm deprecation message for the latest version, if any
  enginesNode?: string // declared engines.node range for the latest version, if any
  vulnerability?: VulnerabilitySummary // Security vulnerability info (loaded on demand)
  allVersions?: string[] // All available versions from registry
  heldByCooldown?: CooldownHold // A newer version exists but minimumReleaseAge withheld it
}

export type DependencyType =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies'

export interface DependencyEntry {
  name: string
  version: string
  type: DependencyType
  packageJsonPath: string
  catalog?: string // pnpm catalog the range is defined in ('default' or a named catalog)
  catalogEntries?: CatalogEntrySummary[] // Full contents of that catalog (for the info modal)
  catalogReferencedBy?: string[] // package.json paths that reference this catalog entry
}

/** One entry of a pnpm catalog, as shown in the info modal's catalog listing. */
export interface CatalogEntrySummary {
  name: string
  range: string
}

export type PackageLoadState = 'pending' | 'ready' | 'failed'

export interface PackageUpgradeChoice {
  name: string
  packageJsonPath: string // File to upgrade (package.json, or pnpm-workspace.yaml for catalog entries)
  dependencyType: DependencyType
  upgradeType: 'none' | 'range' | 'latest'
  targetVersion: string
  currentVersionSpecifier: string // Original version specifier with prefix
  catalog?: string // pnpm catalog to write the new range to ('default' or a named catalog)
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export interface PackageManagerInfo {
  name: PackageManager
  displayName: string
  lockFile: string
  workspaceFile: string | null
  installCommand: string
  /**
   * Install command used after inup writes upgrades to package.json. pnpm and yarn default to
   * frozen/immutable installs under CI (CI=true), which refuse to update the lockfile — the exact
   * thing an upgrade needs. This variant explicitly opts out so the lockfile is regenerated.
   * Falls back to `installCommand` when a manager has no such default (npm, bun).
   */
  writeInstallCommand?: string
  color: ChalkInstance
}

export interface VulnerabilityDisplayOptions {
  showPeerDependencyVulnerabilities?: boolean
  showOptionalDependencyVulnerabilities?: boolean
}

export interface UpgradeOptions extends VulnerabilityDisplayOptions {
  cwd?: string
  excludePatterns?: string[]
  scanDirs?: string[] // Directory names to scan even if in the default skip list (from .inuprc)
  maxDepth?: number // Maximum package.json scan depth, defaults to 10
  packageManager?: PackageManager // Manual override for package manager
  ignorePackages?: string[] // Package names/patterns to ignore (from .inuprc or --ignore flag)
  ignoreMajorPackages?: string[] // Patterns whose major updates are suppressed (from .inuprc ignoreMajor)
  debug?: boolean // Write verbose debug log to /tmp/inup-debug-YYYY-MM-DD.log
  saveExact?: boolean // Write bare versions instead of preserving the range prefix (^/~)
  adaptive?: boolean // Adaptive registry concurrency. Defaults to true.
  concurrency?: number // Pin registry fetch parallelism (1..24) and disable adaptation
  minimumReleaseAge?: number // Minutes a version must have been public before it's offered. 0/absent disables.
  minimumReleaseAgeExclude?: string[] // Package names/patterns exempt from minimumReleaseAge
}

/**
 * Locally persisted network shape learned by the hill-climb concurrency
 * controller. A starting hypothesis for the next run — never a hard cap: the
 * controller re-validates it against live latency at run start and discards it
 * when the network regime changed (different location, VPN, tethering).
 */
export interface NetworkProfile {
  schemaVersion: 1
  /** Last stable HOLD limit the controller settled at. */
  learnedLimit: number
  /** Success-only single-attempt latency EWMA at the end of that run. */
  baselineLatencyMs: number
  /** Window goodput (completions/sec) at settle time; diagnostic only. */
  baselineGoodputRps: number
  /** Completions that informed the profile. */
  sampleCount: number
  /** ISO timestamp; profiles expire after a few days. */
  updatedAt: string
}

export interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  packageManager?: string
  workspaces?: string[] | { packages: string[] }
  [key: string]: unknown
}
