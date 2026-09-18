import { describe, expect, it } from 'vitest'
import type { HeadlessVulnerability } from '../../../../src/features/audit'
import { buildHeadlessReport, renderPlainReport } from '../../../../src/features/headless/report'
import { HEADLESS_SCHEMA_VERSION } from '../../../../src/features/headless/types'
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
    expect(report.summary).toEqual({
      total: 2,
      outdated: 1,
      major: 1,
      vulnerable: 1,
      heldByCooldown: 0,
    })
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
    expect(report.outdated[0]).not.toHaveProperty('catalog')
  })

  it('flags ignoreMajor-suppressed entries and omits the flag otherwise', () => {
    const suppressed = makePackageInfo({ hasMajorUpdate: false, majorIgnored: true })
    const normal = makePackageInfo({ name: 'plain' })

    const report = buildHeadlessReport([suppressed, normal], [suppressed, normal], new Map())

    expect(report.outdated[0]).toMatchObject({ majorIgnored: true, hasMajorUpdate: false })
    expect(report.outdated[1]).not.toHaveProperty('majorIgnored')
  })

  it('includes the pnpm catalog for catalog-sourced entries', () => {
    const pkg = makePackageInfo({
      packageJsonPath: '/repo/pnpm-workspace.yaml',
      catalog: 'react19',
    })

    const report = buildHeadlessReport([pkg], [pkg], new Map())

    expect(report.outdated[0]).toMatchObject({
      catalog: 'react19',
      packageJsonPath: '/repo/pnpm-workspace.yaml',
    })
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

  it('omits the major marker for in-range-only updates', () => {
    const pkg = makePackageInfo({ hasMajorUpdate: false })

    const text = renderPlainReport([pkg], new Map())

    expect(text).toContain('test-pkg')
    expect(text).not.toContain('(major)')
  })

  it('points the arrow at the in-range target for ignoreMajor-suppressed entries', () => {
    const pkg = makePackageInfo({
      hasMajorUpdate: false,
      majorIgnored: true,
      rangeVersion: '1.2.0',
    })

    const text = renderPlainReport([pkg], new Map())

    expect(text).toContain('test-pkg  ^1.0.0 → 1.2.0  [dependencies]')
    expect(text).not.toContain('(major)')
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

describe('release-age cooldown reporting', () => {
  const hold = (version: string, ageMinutes: number, count = 1, eligibleInMinutes = 60) => ({
    version,
    publishedAt: '2024-06-01T00:00:00.000Z',
    ageMinutes,
    eligibleInMinutes,
    count,
  })

  it('lists a fully-held package even though it is not outdated', () => {
    // The critical case: every newer version is inside the window, so the package
    // is not outdated and appears nowhere in `outdated`. Without the top-level
    // array it would be indistinguishable from genuinely up to date.
    const heldPkg = makePackageInfo({
      name: 'held-only',
      isOutdated: false,
      hasMajorUpdate: false,
      heldByCooldown: hold('2.1.0', 30),
    })

    const report = buildHeadlessReport([heldPkg], [], new Map())

    expect(report.summary.heldByCooldown).toBe(1)
    expect(report.heldByCooldown).toEqual([
      {
        name: 'held-only',
        type: 'dependencies',
        packageJsonPath: '/repo/package.json',
        version: '2.1.0',
        publishedAt: '2024-06-01T00:00:00.000Z',
        ageMinutes: 30,
        eligibleInMinutes: 60,
        count: 1,
      },
    ])
  })

  it('also carries the hold inline on an outdated entry', () => {
    const pkg = makePackageInfo({ heldByCooldown: hold('3.0.0', 10, 2) })

    const report = buildHeadlessReport([pkg], [pkg], new Map())

    expect(report.outdated[0].heldByCooldown).toEqual(hold('3.0.0', 10, 2))
    expect(report.heldByCooldown).toHaveLength(1)
  })

  it('reports an empty array and a zero count when the cooldown is off', () => {
    const report = buildHeadlessReport([makePackageInfo()], [makePackageInfo()], new Map())

    expect(report.summary.heldByCooldown).toBe(0)
    expect(report.heldByCooldown).toEqual([])
  })

  it('never claims "up to date" in the plain report while a version is held', () => {
    const heldPkg = makePackageInfo({
      name: 'held-only',
      isOutdated: false,
      heldByCooldown: hold('2.1.0', 90),
    })

    const output = renderPlainReport([], new Map(), [heldPkg])

    expect(output).toContain('Held by release-age cooldown (1)')
    expect(output).toContain('held-only  2.1.0  published 1h ago, 1h left')
  })

  it('appends the cooldown recap after the outdated list', () => {
    const pkg = makePackageInfo({ heldByCooldown: hold('3.0.0', 2880, 3) })

    const output = renderPlainReport([pkg], new Map(), [pkg])

    expect(output).toContain('1 package(s) outdated')
    expect(output).toContain('test-pkg  3.0.0  published 2d ago, 1h left (+2 more)')
  })

  it('counts unique packages in the summary, not per-workspace entries', () => {
    // A workspace repo yields one entry per location. The hold is a property of the
    // published package, so five locations is still one thing to think about.
    const inWorkspace = (path: string) =>
      makePackageInfo({
        name: 'semver',
        isOutdated: false,
        packageJsonPath: path,
        heldByCooldown: hold('7.8.5', 60),
      })
    const all = [
      inWorkspace('/repo/package.json'),
      inWorkspace('/repo/apps/web/package.json'),
      inWorkspace('/repo/apps/api/package.json'),
    ]

    const report = buildHeadlessReport(all, [], new Map())

    expect(report.summary.heldByCooldown).toBe(1)
    // The array still names every location — that detail is real and worth keeping.
    expect(report.heldByCooldown).toHaveLength(3)
    expect(report.heldByCooldown.map((h) => h.packageJsonPath)).toEqual([
      '/repo/package.json',
      '/repo/apps/web/package.json',
      '/repo/apps/api/package.json',
    ])
  })

  it('collapses per-workspace duplicates into one line in the plain report', () => {
    const inWorkspace = (path: string) =>
      makePackageInfo({
        name: 'semver',
        isOutdated: false,
        packageJsonPath: path,
        heldByCooldown: hold('7.8.5', 60),
      })
    const all = [inWorkspace('/repo/package.json'), inWorkspace('/repo/apps/web/package.json')]

    const output = renderPlainReport([], new Map(), all)

    expect(output).toContain('Held by release-age cooldown (1):')
    expect(output.match(/semver {2}7\.8\.5/g)).toHaveLength(1)
  })

  it('keeps distinct held versions of the same package on separate lines', () => {
    const all = [
      makePackageInfo({ name: 'semver', isOutdated: false, heldByCooldown: hold('7.8.5', 60) }),
      makePackageInfo({ name: 'semver', isOutdated: false, heldByCooldown: hold('8.0.0', 30) }),
    ]

    const output = renderPlainReport([], new Map(), all)

    expect(output).toContain('Held by release-age cooldown (2):')
    expect(output).toContain('semver  7.8.5')
    expect(output).toContain('semver  8.0.0')
  })

  it('renders sub-hour ages in minutes', () => {
    const pkg = makePackageInfo({ heldByCooldown: hold('3.0.0', 45) })

    expect(renderPlainReport([pkg], new Map(), [pkg])).toContain('published 45m ago')
  })

  it('leaves the remaining time off a hold that clears on the next run', () => {
    // ", 0m left" on a line that exists to say the version is being withheld reads as a
    // contradiction; the absence of the clause is the honest form.
    const pkg = makePackageInfo({ heldByCooldown: hold('3.0.0', 1440, 1, 0) })

    const output = renderPlainReport([pkg], new Map(), [pkg])

    expect(output).toContain('published 1d ago')
    expect(output).not.toContain('left')
  })

  it('omits the cooldown recap entirely when nothing is held', () => {
    expect(renderPlainReport([], new Map(), [makePackageInfo({ isOutdated: false })])).toBe(
      'All dependencies are up to date — no upgrades needed.'
    )
  })
})
