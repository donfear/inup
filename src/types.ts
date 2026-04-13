export interface VulnerabilitySummary {
  count: number
  highestSeverity: 'info' | 'low' | 'moderate' | 'high' | 'critical'
  detailsUrl?: string
  advisories: Array<{
    id: number
    title: string
    severity: 'info' | 'low' | 'moderate' | 'high' | 'critical'
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
  vulnerability?: VulnerabilitySummary // Security vulnerability info (loaded on demand)
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

export interface PackageSelectionState {
  name: string
  packageJsonPath: string // Primary path to the package.json file (for display)
  packageJsonPaths?: string[] // All package.json paths where this package appears
  currentVersionSpecifier: string // Original version specifier with prefix
  currentVersion: string
  rangeVersion: string
  latestVersion: string
  selectedOption: 'none' | 'range' | 'latest'
  loadState: PackageLoadState
  hasRangeUpdate: boolean
  hasMajorUpdate: boolean
  type: DependencyType
  description?: string // Package description from npm registry
  homepage?: string // Package homepage URL
  repository?: string // GitHub/repository URL for releases
  weeklyDownloads?: number // Weekly download count from npm
  author?: string // Package author
  license?: string // Package license
  vulnerability?: VulnerabilitySummary // Security vulnerability info (loaded on demand)
}

export interface GroupedPackages {
  main: PackageSelectionState[] // dependencies + devDependencies
  peer: PackageSelectionState[] // peerDependencies
  optional: PackageSelectionState[] // optionalDependencies
}

export type RenderableItem =
  | { type: 'header'; title: string; sectionType: 'main' | 'peer' | 'optional' }
  | { type: 'spacer' }
  | { type: 'package'; state: PackageSelectionState; originalIndex: number }

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export interface PackageManagerInfo {
  name: PackageManager
  displayName: string
  lockFile: string
  workspaceFile: string | null
  installCommand: string
  color: any // chalk instance
}

export interface UpgradeOptions {
  cwd?: string
  excludePatterns?: string[]
  maxDepth?: number // Maximum package.json scan depth, defaults to 10
  packageManager?: PackageManager // Manual override for package manager
  ignorePackages?: string[] // Package names/patterns to ignore (from .inuprc or --ignore flag)
  debug?: boolean // Write verbose debug log to /tmp/inup-debug-YYYY-MM-DD.log
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

export interface PackageLoadProgress {
  discovered: number
  resolved: number
  total: number
  failed: number
  isLoading: boolean
}

export interface AuditProgress {
  completed: number
  total: number
  isRunning: boolean
  hasData: boolean
}

export interface StreamOutdatedPackagesInitialPayload {
  allDependencies: DependencyEntry[]
  uniquePackages: string[]
  currentVersions: Map<string, string>
  progress: PackageLoadProgress
}

export interface StreamOutdatedPackagesBatchItem {
  packageName: string
  packageInfo: PackageInfo[]
  failed: boolean
}

export type StreamOutdatedPackagesEvent =
  | { type: 'initial'; payload: StreamOutdatedPackagesInitialPayload }
  | {
      type: 'batch'
      payload: {
        batch: StreamOutdatedPackagesBatchItem[]
        progress: PackageLoadProgress
      }
    }
  | { type: 'complete'; payload: { packages: PackageInfo[]; progress: PackageLoadProgress } }

export type StreamOutdatedPackagesCallback = (event: StreamOutdatedPackagesEvent) => void

export interface RegistryBatchOptions {
  batchSize?: number
  batchSizes?: number[]
  concurrency?: number
}

export interface RegistryBatchProgressItem {
  packageName: string
  data: { latestVersion: string; allVersions: string[] }
  completed: number
  total: number
  batchIndex: number
  itemIndex: number
}

export type OnBatchReadyCallback = (batch: RegistryBatchProgressItem[]) => void
