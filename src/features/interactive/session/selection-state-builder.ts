import type {
  PackageInfo,
  PackageSelectionState,
  PackageUpgradeChoice,
  VulnerabilitySummary,
} from '../../../shared/types'
import {
  applyVersionPrefix,
  parseCurrentVersion,
  toComparableVersion,
} from '../../../shared/versions'

type CachedSummaryFn = (
  name: string,
  version: string,
  type: PackageSelectionState['type']
) => VulnerabilitySummary | undefined

/**
 * Identity of a selectable row. Catalog entries carry the catalog name so a
 * pnpm catalog entry never merges with a direct dependency that happens to have
 * the same name/range/type — they are written to different files.
 */
export function selectionKey(
  name: string,
  versionSpecifier: string,
  type: string,
  catalog?: string
): string {
  const base = `${name}@${versionSpecifier}@${type}`
  return catalog ? `${base}@catalog:${catalog}` : base
}

/** List order: scoped packages first, then by name. */
export function comparePackageNames(a: string, b: string): number {
  const aIsScoped = a.startsWith('@')
  const bIsScoped = b.startsWith('@')
  if (aIsScoped && !bIsScoped) return -1
  if (!aIsScoped && bIsScoped) return 1
  return a.localeCompare(b)
}

export function deduplicatePackages(
  packages: PackageInfo[]
): Map<string, { pkg: PackageInfo; packageJsonPaths: Set<string> }> {
  const uniquePackages = new Map<string, { pkg: PackageInfo; packageJsonPaths: Set<string> }>()

  for (const pkg of packages) {
    const key = selectionKey(pkg.name, pkg.currentVersion, pkg.type, pkg.catalog)
    const existing = uniquePackages.get(key)
    if (existing) {
      existing.packageJsonPaths.add(pkg.packageJsonPath)
    } else {
      uniquePackages.set(key, {
        pkg,
        packageJsonPaths: new Set([pkg.packageJsonPath]),
      })
    }
  }

  return new Map(
    Array.from(uniquePackages.entries()).sort(([, a], [, b]) =>
      comparePackageNames(a.pkg.name, b.pkg.name)
    )
  )
}

export function createSelectionStates(
  packages: PackageInfo[],
  getCachedSummary: CachedSummaryFn,
  previousSelections?: Map<string, 'none' | 'range' | 'latest'>,
  includeUpToDate: boolean = true
): PackageSelectionState[] {
  // A package the cooldown emptied out is not outdated — every version newer than the
  // installed one is inside the window — but it is exactly what the run needs to be able
  // to show. It earns a row, marked `heldOnly` so the filters can keep it out of the way.
  const relevantPackages = includeUpToDate
    ? packages
    : packages.filter((p) => p.isOutdated || p.heldByCooldown !== undefined)
  const uniquePackages = deduplicatePackages(relevantPackages)

  return Array.from(uniquePackages.values()).map(({ pkg, packageJsonPaths }) => {
    // parseCurrentVersion / toComparableVersion preserve prerelease tags —
    // coerce would strip '-rc.3' and the upgrade would silently write ^1.0.0.
    const currentClean = parseCurrentVersion(pkg.currentVersion)?.version || pkg.currentVersion
    const rangeClean = toComparableVersion(pkg.rangeVersion) || pkg.rangeVersion
    const latestClean = toComparableVersion(pkg.latestVersion) || pkg.latestVersion
    const key = selectionKey(pkg.name, pkg.currentVersion, pkg.type, pkg.catalog)
    const previousSelection = previousSelections?.get(key) || 'none'

    return {
      name: pkg.name,
      packageJsonPath: pkg.packageJsonPath,
      packageJsonPaths: Array.from(packageJsonPaths),
      currentVersionSpecifier: pkg.currentVersion,
      currentVersion: currentClean,
      rangeVersion: rangeClean,
      latestVersion: latestClean,
      selectedOption: previousSelection,
      loadState: 'ready',
      hasRangeUpdate: pkg.hasRangeUpdate,
      hasMajorUpdate: pkg.hasMajorUpdate,
      type: pkg.type,
      catalog: pkg.catalog,
      catalogEntries: pkg.catalogEntries,
      catalogReferencedBy: pkg.catalogReferencedBy,
      deprecated: pkg.deprecated,
      enginesNode: pkg.enginesNode,
      heldByCooldown: pkg.heldByCooldown,
      heldOnly: !pkg.isOutdated && pkg.heldByCooldown !== undefined,
      vulnerability: getCachedSummary(pkg.name, pkg.currentVersion, pkg.type),
      allVersions: pkg.allVersions,
    }
  })
}

export function createPendingSelectionStates(
  packages: Array<
    Pick<PackageInfo, 'name' | 'currentVersion' | 'type' | 'packageJsonPath' | 'catalog'>
  >,
  getCachedSummary: CachedSummaryFn,
  previousSelections?: Map<string, 'none' | 'range' | 'latest'>
): PackageSelectionState[] {
  const uniquePackages = deduplicatePackages(
    packages.map((pkg) => ({
      ...pkg,
      rangeVersion: pkg.currentVersion,
      latestVersion: pkg.currentVersion,
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    }))
  )

  return Array.from(uniquePackages.values()).map(({ pkg, packageJsonPaths }) => {
    const currentClean = parseCurrentVersion(pkg.currentVersion)?.version || pkg.currentVersion
    const key = selectionKey(pkg.name, pkg.currentVersion, pkg.type, pkg.catalog)
    const previousSelection = previousSelections?.get(key) || 'none'

    return {
      name: pkg.name,
      packageJsonPath: pkg.packageJsonPath,
      packageJsonPaths: Array.from(packageJsonPaths),
      currentVersionSpecifier: pkg.currentVersion,
      currentVersion: currentClean,
      rangeVersion: 'loading',
      latestVersion: 'loading',
      selectedOption: previousSelection,
      loadState: 'pending',
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      type: pkg.type,
      catalog: pkg.catalog,
      vulnerability: getCachedSummary(pkg.name, pkg.currentVersion, pkg.type),
    }
  })
}

export function createUpgradeChoices(
  selectedStates: PackageSelectionState[],
  saveExact: boolean = false
): PackageUpgradeChoice[] {
  const choices: PackageUpgradeChoice[] = []
  selectedStates
    .filter((state) => state.loadState === 'ready' && state.selectedOption !== 'none')
    .forEach((state) => {
      const targetVersion =
        state.selectedOption === 'range' ? state.rangeVersion : state.latestVersion
      // Preserve the original range prefix (^/~) by default; --save-exact writes the bare version.
      const targetVersionWithPrefix = saveExact
        ? targetVersion
        : applyVersionPrefix(state.currentVersionSpecifier, targetVersion)

      const pathsToUpdate = state.packageJsonPaths || [state.packageJsonPath]
      pathsToUpdate.forEach((packageJsonPath) => {
        choices.push({
          name: state.name,
          packageJsonPath,
          dependencyType: state.type,
          upgradeType: state.selectedOption,
          targetVersion: targetVersionWithPrefix,
          currentVersionSpecifier: state.currentVersionSpecifier,
          catalog: state.catalog,
        })
      })
    })

  return choices
}
