import { PackageSelectionState } from '../../src/shared/types'

export function makeSelectionState(overrides?: Partial<PackageSelectionState>): PackageSelectionState {
  return {
    name: 'test-pkg',
    packageJsonPath: '/repo/package.json',
    packageJsonPaths: ['/repo/package.json'],
    currentVersionSpecifier: '^1.0.0',
    currentVersion: '1.0.0',
    rangeVersion: '1.1.0',
    latestVersion: '2.0.0',
    selectedOption: 'none',
    loadState: 'ready',
    hasRangeUpdate: true,
    hasMajorUpdate: true,
    type: 'dependencies',
    ...overrides,
  }
}
