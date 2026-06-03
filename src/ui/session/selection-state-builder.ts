import * as semver from 'semver'
import {
  DependencyEntry,
  PackageInfo,
  PackageSelectionState,
  PackageUpgradeChoice,
  VulnerabilitySummary,
} from '../../types'
import { applyVersionPrefix } from '../utils'

/**
 * Shared ordering for package lists: scoped packages (@…) first, then
 * alphabetical. Used by deduplicatePackages and by the append-sort that keeps
 * streamed-in outdated rows interleaved with seeded ignored rows.
 */
export function comparePackageNames(a: string, b: string): number {
  const aIsScoped = a.startsWith('@')
  const bIsScoped = b.startsWith('@')
  if (aIsScoped && !bIsScoped) return -1
  if (!aIsScoped && bIsScoped) return 1
  return a.localeCompare(b)
}

type CachedSummaryFn = (
  name: string,
  version: string,
  type: PackageSelectionState['type']
) => VulnerabilitySummary | undefined

export function deduplicatePackages(
  packages: PackageInfo[]
): Map<string, { pkg: PackageInfo; packageJsonPaths: Set<string> }> {
  const uniquePackages = new Map<string, { pkg: PackageInfo; packageJsonPaths: Set<string> }>()

  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.currentVersion}@${pkg.type}`
    if (!uniquePackages.has(key)) {
      uniquePackages.set(key, {
        pkg,
        packageJsonPaths: new Set([pkg.packageJsonPath]),
      })
    } else {
      uniquePackages.get(key)!.packageJsonPaths.add(pkg.packageJsonPath)
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
  const relevantPackages = includeUpToDate ? packages : packages.filter((p) => p.isOutdated)
  const uniquePackages = deduplicatePackages(relevantPackages)

  return Array.from(uniquePackages.values()).map(({ pkg, packageJsonPaths }) => {
    const currentClean = semver.coerce(pkg.currentVersion)?.version || pkg.currentVersion
    const rangeClean = semver.coerce(pkg.rangeVersion)?.version || pkg.rangeVersion
    const latestClean = semver.coerce(pkg.latestVersion)?.version || pkg.latestVersion
    const key = `${pkg.name}@${pkg.currentVersion}@${pkg.type}`
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
      deprecated: pkg.deprecated,
      enginesNode: pkg.enginesNode,
      vulnerability: getCachedSummary(pkg.name, pkg.currentVersion, pkg.type),
      allVersions: pkg.allVersions,
    }
  })
}

export function createPendingSelectionStates(
  packages: Array<Pick<PackageInfo, 'name' | 'currentVersion' | 'type' | 'packageJsonPath'>>,
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
    const currentClean = semver.coerce(pkg.currentVersion)?.version || pkg.currentVersion
    const key = `${pkg.name}@${pkg.currentVersion}@${pkg.type}`
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
      vulnerability: getCachedSummary(pkg.name, pkg.currentVersion, pkg.type),
    }
  })
}

/**
 * Build display-only states for packages matched by the `.inuprc` ignore list.
 * These are rendered grayed-out and are never fetched, selected, or upgraded —
 * the `loadState: 'ignored'` value gates them out of every selection guard and
 * out of createUpgradeChoices (which requires loadState === 'ready').
 */
export function createIgnoredSelectionStates(
  ignoredDeps: DependencyEntry[]
): PackageSelectionState[] {
  const uniquePackages = deduplicatePackages(
    ignoredDeps.map((dep) => ({
      name: dep.name,
      currentVersion: dep.version,
      rangeVersion: dep.version,
      latestVersion: dep.version,
      type: dep.type,
      packageJsonPath: dep.packageJsonPath,
      isOutdated: false,
      hasRangeUpdate: false,
      hasMajorUpdate: false,
    }))
  )

  return Array.from(uniquePackages.values()).map(({ pkg, packageJsonPaths }) => {
    const currentClean = semver.coerce(pkg.currentVersion)?.version || pkg.currentVersion

    return {
      name: pkg.name,
      packageJsonPath: pkg.packageJsonPath,
      packageJsonPaths: Array.from(packageJsonPaths),
      currentVersionSpecifier: pkg.currentVersion,
      currentVersion: currentClean,
      rangeVersion: currentClean,
      latestVersion: currentClean,
      selectedOption: 'none',
      loadState: 'ignored',
      hasRangeUpdate: false,
      hasMajorUpdate: false,
      type: pkg.type,
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
        })
      })
    })

  return choices
}
