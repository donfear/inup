import * as semver from 'semver'
import {
  PackageInfo,
  PackageSelectionState,
  PackageUpgradeChoice,
  VulnerabilitySummary,
} from '../../types'
import { applyVersionPrefix } from '../utils'

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
    Array.from(uniquePackages.entries()).sort(([, a], [, b]) => {
      const aIsScoped = a.pkg.name.startsWith('@')
      const bIsScoped = b.pkg.name.startsWith('@')
      if (aIsScoped && !bIsScoped) return -1
      if (!aIsScoped && bIsScoped) return 1
      return a.pkg.name.localeCompare(b.pkg.name)
    })
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
