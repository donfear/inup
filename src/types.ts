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
}

export interface PackageUpgradeChoice {
  name: string
  packageJsonPath: string // Path to the package.json file to upgrade
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
  hasRangeUpdate: boolean
  hasMajorUpdate: boolean
  type: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies'
  description?: string // Package description from npm registry
  homepage?: string // Package homepage URL
  repository?: string // GitHub/repository URL for releases
  weeklyDownloads?: number // Weekly download count from npm
  author?: string // Package author
  license?: string // Package license
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
  packageManager?: PackageManager // Manual override for package manager
  ignorePackages?: string[] // Package names/patterns to ignore (from .inuprc or --ignore flag)
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

export type OnBatchReadyCallback = (
  batch: Array<{ name: string; data: { latestVersion: string; allVersions: string[] } }>
) => void
