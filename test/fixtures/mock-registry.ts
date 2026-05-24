import { vi } from 'vitest'
import { PackageVersionData } from '../../src/services/npm-registry'

interface MockRegistryOptions {
  packageData?: Map<string, PackageVersionData>
  defaultData?: PackageVersionData
}

export function mockRegistry(options: MockRegistryOptions = {}) {
  const defaultData: PackageVersionData = options.defaultData ?? {
    latestVersion: '2.0.0',
    allVersions: ['2.0.0', '1.1.0', '1.0.0'],
  }

  const fetchPackageVersions = vi.fn().mockImplementation(
    async (packageNames: string[], opts: { onBatchReady?: (batch: unknown[]) => void }) => {
      const batch = packageNames.map((name) => ({
        name,
        ...(options.packageData?.get(name) ?? defaultData),
      }))
      opts.onBatchReady?.(batch)
    }
  )

  const getAllPackageDataFromJsdelivr = vi.fn().mockImplementation(
    async (packageNames: string[]) => {
      const result = new Map<string, PackageVersionData>()
      for (const name of packageNames) {
        result.set(name, options.packageData?.get(name) ?? defaultData)
      }
      return result
    }
  )

  return { fetchPackageVersions, getAllPackageDataFromJsdelivr }
}
