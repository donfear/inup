import { describe, expect, it } from 'vitest'
import { renderInterface, renderPackageLine } from '../../../../src/features/interactive/renderer/package-list'
import { VersionUtils } from '../../../../src/features/interactive/renderer/version-format'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

const baseState = makeSelectionState({ name: 'demo-pkg' })

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
    expect(lowLine).toContain('[LOW]')
  })

  it('renders moderate badge without internal padding', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        vulnerability: {
          count: 1,
          highestSeverity: 'moderate',
          detailsUrl: 'https://github.com/advisories/GHSA-mod',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(line).toContain('[MOD]')
    expect(line).not.toContain('[MOD ]')
  })

  it('hides peer dependency vulnerability badges by default', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'peerDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-peer',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(line).not.toContain('[HIGH]')
    expect(line).toContain('[P]')
  })

  it('shows peer dependency vulnerability badges when enabled', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'peerDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-peer',
          advisories: [],
        },
      },
      0,
      false,
      120,
      { showPeerDependencyVulnerabilities: true }
    )

    expect(line).toContain('[HIGH]')
    expect(line).toContain('[P]')
  })

  it('hides optional dependency vulnerability badges by default', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'optionalDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-optional',
          advisories: [],
        },
      },
      0,
      false,
      120
    )

    expect(line).not.toContain('[HIGH]')
    expect(line).toContain('[O]')
  })

  it('shows optional dependency vulnerability badges when enabled', () => {
    const line = renderPackageLine(
      {
        ...baseState,
        type: 'optionalDependencies',
        vulnerability: {
          count: 1,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-optional',
          advisories: [],
        },
      },
      0,
      false,
      120,
      { showOptionalDependencyVulnerabilities: true }
    )

    expect(line).toContain('[HIGH]')
    expect(line).toContain('[O]')
  })

  it('pads rendered list rows to the terminal width', () => {
    const lines = renderInterface([baseState], 0, 0, 10, false, [], 'Deps', undefined, false, '', 1, 120)

    expect(lines.every((line) => VersionUtils.getVisualLength(line) >= 120)).toBe(true)
  })
})
