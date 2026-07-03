import { describe, expect, it } from 'vitest'
import { buildHeadlessReport, renderPlainReport } from '../../../../src/features/headless/report'
import { HEADLESS_SCHEMA_VERSION } from '../../../../src/features/headless/types'
import type { HeadlessVulnerability } from '../../../../src/features/audit'
import type { PackageInfo } from '../../../../src/shared/types'
import { makePackageInfo } from '../../../fixtures/package-info-factory'

const vulnerability = (overrides?: Partial<HeadlessVulnerability>): HeadlessVulnerability => ({
  count: 2,
  highestSeverity: 'high',
  fixedByRange: false,
  fixedByLatest: false,
  advisories: [],
  ...overrides,
})

describe('buildHeadlessReport', () => {
  it('summarizes totals and maps each outdated package', () => {
    const outdatedPkg = makePackageInfo({ deprecated: 'use other', enginesNode: '>=18' })
    const currentPkg = makePackageInfo({ name: 'fresh', isOutdated: false, hasMajorUpdate: false })
    const vulns: Map<PackageInfo, HeadlessVulnerability> = new Map([[outdatedPkg, vulnerability()]])

    const report = buildHeadlessReport([outdatedPkg, currentPkg], [outdatedPkg], vulns)

    expect(report.schemaVersion).toBe(HEADLESS_SCHEMA_VERSION)
    expect(report.summary).toEqual({ total: 2, outdated: 1, major: 1, vulnerable: 1 })
    expect(report.outdated[0]).toMatchObject({
      name: 'test-pkg',
      current: '^1.0.0',
      latest: '2.0.0',
      deprecated: 'use other',
      enginesNode: '>=18',
      vulnerability: expect.objectContaining({ highestSeverity: 'high' }),
    })
  })

  it('omits optional fields when absent', () => {
    const pkg = makePackageInfo()

    const report = buildHeadlessReport([pkg], [pkg], new Map())

    expect(report.outdated[0]).not.toHaveProperty('deprecated')
    expect(report.outdated[0]).not.toHaveProperty('vulnerability')
  })
})

describe('renderPlainReport', () => {
  it('reports an up-to-date project in one line', () => {
    expect(renderPlainReport([], new Map())).toBe(
      'All dependencies are up to date — no upgrades needed.'
    )
  })

  it('lists each outdated package with markers and a recap', () => {
    const pkg = makePackageInfo({ deprecated: 'gone' })

    const text = renderPlainReport([pkg], new Map())

    expect(text).toContain('test-pkg  ^1.0.0 → 2.0.0  [dependencies] (major)  [deprecated]')
    expect(text).toContain('1 package(s) outdated across 1 file(s).')
  })

  it('tags vulnerabilities with the cheapest fixing action', () => {
    const byRange = makePackageInfo({ name: 'range-fix' })
    const byLatest = makePackageInfo({ name: 'latest-fix' })
    const unfixed = makePackageInfo({ name: 'still-vuln' })
    const vulns: Map<PackageInfo, HeadlessVulnerability> = new Map([
      [byRange, vulnerability({ fixedByRange: true, fixedByLatest: true, count: 1 })],
      [byLatest, vulnerability({ fixedByLatest: true })],
      [unfixed, vulnerability()],
    ])

    const text = renderPlainReport([byRange, byLatest, unfixed], vulns)

    expect(text).toContain('[vuln: 1 high → fixed by range upgrade]')
    expect(text).toContain('[vuln: 2 high → fixed by latest only]')
    expect(text).toContain('[vuln: 2 high → not fixed by upgrade]')
    expect(text).toContain('3 with known vulnerabilities')
  })
})
