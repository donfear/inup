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

export interface PackageInfo {
  name: string
  currentVersion: string // Raw version specifier from package.json (with ^/~ prefixes)
  rangeVersion: string // Version that satisfies current range
  latestVersion: string // Absolute latest version
  type: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
  packageJsonPath: string // Path to the package.json file
  isOutdated: boolean
  hasRangeUpdate: boolean // If range version is different from current
  hasMajorUpdate: boolean // If latest version is a major update
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
}

export type PackageLoadState = 'pending' | 'ready' | 'failed'

export interface PackageUpgradeChoice {
  name: string
  packageJsonPath: string // Path to the package.json file to upgrade
  dependencyType: DependencyType
  upgradeType: 'none' | 'range' | 'latest'
  targetVersion: string
  currentVersionSpecifier: string // Original version specifier with prefix
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export interface PackageManagerInfo {
  name: PackageManager
  displayName: string
  lockFile: string
  workspaceFile: string | null
  installCommand: string
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
  debug?: boolean // Write verbose debug log to /tmp/inup-debug-YYYY-MM-DD.log
  saveExact?: boolean // Write bare versions instead of preserving the range prefix (^/~)
}

export interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  packageManager?: string
  workspaces?: string[] | { packages: string[] }
  [key: string]: any
}
