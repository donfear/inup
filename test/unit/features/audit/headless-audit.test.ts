import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchVulnerabilities: vi.fn() }))

vi.mock('../../../../src/features/audit/vulnerability-checker', () => ({
  fetchVulnerabilities: mocks.fetchVulnerabilities,
}))

import { auditVulnerabilities, upgradeClears } from '../../../../src/features/audit'

describe('upgradeClears', () => {
  it('reports a fix when the target escapes the affected range', () => {
    expect(upgradeClears('1.16.1', '<1.0.0')).toBe(true)
    expect(upgradeClears('2.0.0', '>=0.1.0 <1.5.0')).toBe(true)
  })

  it('reports no fix when the target is still in the affected range', () => {
    expect(upgradeClears('0.27.2', '<1.0.0')).toBe(false)
    expect(upgradeClears('1.0.0', '>=0.0.1')).toBe(false)
  })

  it('is conservative: an unparseable target or range is NOT a fix', () => {
    expect(upgradeClears('not-a-version', '<1.0.0')).toBe(false)
    expect(upgradeClears('1.0.0', 'definitely-not-a-range')).toBe(false)
  })

  it('coerces loose target versions (prefixes) before comparing', () => {
    expect(upgradeClears('^1.16.1', '<1.0.0')).toBe(true)
  })
})

describe('auditVulnerabilities', () => {
  const pkg = {
    name: 'axios',
    currentVersion: '^0.27.0',
    rangeVersion: '0.27.2',
    latestVersion: '1.16.1',
    type: 'dependencies',
    packageJsonPath: '/repo/package.json',
    isOutdated: true,
    hasRangeUpdate: true,
    hasMajorUpdate: true,
  } as any

  beforeEach(() => vi.clearAllMocks())

  it('returns an empty map and skips the network when there is nothing outdated', async () => {
    const result = await auditVulnerabilities([])
    expect(result.size).toBe(0)
    expect(mocks.fetchVulnerabilities).not.toHaveBeenCalled()
  })

  it('aggregates per-advisory fix verdicts with AND across advisories', async () => {
    mocks.fetchVulnerabilities.mockResolvedValue(
      new Map([
        [
          'axios',
          {
            packageName: 'axios',
            highestSeverity: 'high',
            vulnerabilities: [
              { id: 1, title: 'A', severity: 'high', url: 'u1', vulnerable_versions: '<1.0.0' },
              { id: 2, title: 'B', severity: 'moderate', url: 'u2', vulnerable_versions: '>=0.0.1' },
            ],
          },
        ],
      ])
    )

    const result = await auditVulnerabilities([pkg])
    const summary = result.get(pkg)!

    expect(summary.count).toBe(2)
    expect(summary.highestSeverity).toBe('high')
    // Advisory B (>=0.0.1) affects every target, so neither aggregate can be a full fix.
    expect(summary.fixedByRange).toBe(false)
    expect(summary.fixedByLatest).toBe(false)
    expect(summary.advisories[0]).toMatchObject({ id: 1, fixedByLatest: true, fixedByRange: false })
    expect(summary.advisories[1]).toMatchObject({ id: 2, fixedByLatest: false, fixedByRange: false })
  })

  it('omits packages with no advisories', async () => {
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
    const result = await auditVulnerabilities([pkg])
    expect(result.size).toBe(0)
  })
})
