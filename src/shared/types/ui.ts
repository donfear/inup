import type {
  CatalogEntrySummary,
  CooldownHold,
  DependencyType,
  PackageLoadState,
  VulnerabilitySummary,
} from './domain'

/**
 * Live cooldown status the picker header reads every frame.
 *
 * Mutable and shared by reference: the session mounts before scanning, so these values are
 * still zero on the first frame and only become true partway through the run.
 */
export interface CooldownRenderStatus {
  /**
   * Packages the cooldown withheld a version from that are NOT in the list. The list holds
   * only outdated packages, so a package whose every newer version is inside the window has
   * no row to badge and would otherwise be indistinguishable from up to date.
   */
  heldCount: number
  /**
   * The configured cooldown could not act — the registry returned no publish times. Shown
   * because the policy fails open, so an inert cooldown otherwise looks like a satisfied one.
   */
  unsupported: boolean
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
  catalog?: string // pnpm catalog the range is defined in ('default' or a named catalog)
  catalogEntries?: CatalogEntrySummary[] // Full contents of that catalog (for the info modal)
  catalogReferencedBy?: string[] // package.json paths that reference this catalog entry
  description?: string // Package description from npm registry
  homepage?: string // Package homepage URL
  repository?: string // GitHub/repository URL for releases
  weeklyDownloads?: number // Weekly download count from npm
  author?: string // Package author
  license?: string // Package license
  deprecated?: string // npm deprecation message for the latest version (loaded on demand)
  enginesNode?: string // declared engines.node range for the latest version (loaded on demand)
  heldByCooldown?: CooldownHold // A newer version exists but minimumReleaseAge withheld it
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
