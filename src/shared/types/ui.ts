import type { DependencyType, PackageLoadState, VulnerabilitySummary } from './domain'

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
  deprecated?: string // npm deprecation message for the latest version (loaded on demand)
  enginesNode?: string // declared engines.node range for the latest version (loaded on demand)
  vulnerability?: VulnerabilitySummary // Security vulnerability info (loaded on demand)
  allVersions?: string[] // All available versions (for release notes version range)
  releaseNotesVersions?: string[] // Versions between current and target (newest first)
  releaseNotesLoaded?: Map<string, string | null> // version → content (null = unavailable)
  releaseNotesLoadingVersion?: string // Currently loading this version's notes
  releaseNotesViewIndex?: number // Index into releaseNotesVersions of the version being viewed
}

export type StateUpdate = { name: string; patch: Partial<PackageSelectionState> }

/** Dependency-type visibility toggles persisted across runs (transient search state excluded). */
export interface PersistedFilters {
  showDependencies: boolean
  showDevDependencies: boolean
  showPeerDependencies: boolean
  showOptionalDependencies: boolean
  showOnlyVulnerable: boolean
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
