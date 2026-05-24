import { PackageInfo } from '../../src/types'

export function makePackageInfo(overrides?: Partial<PackageInfo>): PackageInfo {
  return {
    name: 'test-pkg',
    currentVersion: '^1.0.0',
    rangeVersion: '1.1.0',
    latestVersion: '2.0.0',
    type: 'dependencies',
    packageJsonPath: '/repo/package.json',
    isOutdated: true,
    hasRangeUpdate: true,
    hasMajorUpdate: true,
    ...overrides,
  }
}
