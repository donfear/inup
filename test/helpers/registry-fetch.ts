import type {
  PackageVersionData,
  PackageVersionFetch,
  PackageVersionFetchOptions,
} from '../../src/shared/registry/npm-registry'

type ListFetch = (packageNames: string[], options: PackageVersionFetchOptions) => unknown

/**
 * A `startPackageVersionFetch` stand-in for tests that describe the registry as one call over a
 * finished list: it collects the packages the detector adds while it scans, and hands them to
 * `fetchList` when the run finishes.
 */
export function collectedFetch(fetchList: ListFetch) {
  return (options: PackageVersionFetchOptions): PackageVersionFetch => {
    const packageNames: string[] = []
    return {
      add: (names) => {
        packageNames.push(...names)
      },
      finish: async () => {
        await fetchList(packageNames, options)
        return new Map<string, PackageVersionData>()
      },
    }
  }
}
