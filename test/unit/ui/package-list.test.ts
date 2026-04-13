import { describe, expect, it } from 'vitest'
import { renderPackageLine } from '../../../src/ui/renderer/package-list'
import { PackageSelectionState } from '../../../src/types'
import { VersionUtils } from '../../../src/ui/utils'

const baseState: PackageSelectionState = {
  name: 'demo-pkg',
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
}

describe('package-list renderer', () => {
  it('renders pending rows with loading placeholders', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        loadState: 'pending',
        rangeVersion: 'loading',
        latestVersion: 'loading',
        hasRangeUpdate: false,
        hasMajorUpdate: false,
      },
      0,
      true,
      120
    )

    expect(line).toContain('loading')
  })

  it('renders failed rows as unavailable and keeps layout stable', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        loadState: 'failed',
        rangeVersion: 'unknown',
        latestVersion: 'unknown',
        hasRangeUpdate: false,
        hasMajorUpdate: false,
      },
      0,
      false,
      120
    )

    expect(line).toContain('unavailable')
  })

  it('uses fixed-width vulnerability badges so rows stay aligned', () => {
    const highLine = renderPackageLine(
      {
        ...baseState,
        vulnerability: {
          count: 2,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-high',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    const lowLine = renderPackageLine(
      {
        ...baseState,
        vulnerability: {
          count: 1,
          highestSeverity: 'low',
          detailsUrl: 'https://github.com/advisories/GHSA-low',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(highLine).toContain('[HIGH]')
    expect(lowLine).toContain('[LOW ]')
    expect(VersionUtils.getVisualLength(highLine)).toBe(VersionUtils.getVisualLength(lowLine))
  })
})
