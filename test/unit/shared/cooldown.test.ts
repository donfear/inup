import semver from 'semver'
import { describe, expect, it } from 'vitest'
import {
  applyReleaseAgeCooldown,
  buildCooldownHold,
  countHeldPackages,
  packagesWithHolds,
} from '../../../src/shared/cooldown'
import type { ParsedVersions } from '../../../src/shared/versions'

const NOW = Date.parse('2026-09-18T12:00:00.000Z')
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()

/** One hour, so "5 minutes old" is fresh and "10 000 minutes old" is not. */
const WINDOW = 60

const parsed = (over: Partial<ParsedVersions> = {}): ParsedVersions => ({
  latestVersion: '1.2.0',
  allVersions: ['1.2.0', '1.1.0', '1.0.0'],
  prereleaseVersions: [],
  publishTimes: {
    '1.2.0': minutesAgo(5),
    '1.1.0': minutesAgo(10_000),
    '1.0.0': minutesAgo(20_000),
  },
  ...over,
})

const run = (
  data: ParsedVersions,
  over: Partial<Parameters<typeof applyReleaseAgeCooldown>[1]> = {}
) =>
  applyReleaseAgeCooldown(data, {
    minimumReleaseAgeMinutes: WINDOW,
    installed: semver.parse('1.0.0'),
    specifier: '^1.0.0',
    now: NOW,
    ...over,
  })

describe('applyReleaseAgeCooldown', () => {
  it('is a pass-through when the window is zero or negative', () => {
    const data = parsed()

    for (const minimumReleaseAgeMinutes of [0, -1]) {
      const decision = run(data, { minimumReleaseAgeMinutes })
      // Same object, not a copy: a disabled policy must not even reshape the packument.
      expect(decision.data).toBe(data)
      expect(decision.held).toBeUndefined()
      expect(decision.withheldTotal).toBe(0)
    }
  })

  it('is a pass-through when the registry exposes no publish times', () => {
    // Fail open. Acting on absent evidence would hide every version of every package.
    const data = parsed({ publishTimes: undefined })

    const decision = run(data)

    expect(decision.data).toBe(data)
    expect(decision.withheldTotal).toBe(0)
  })

  it('is a pass-through when every version is already old enough', () => {
    const data = parsed({
      publishTimes: {
        '1.2.0': minutesAgo(10_000),
        '1.1.0': minutesAgo(20_000),
        '1.0.0': minutesAgo(30_000),
      },
    })

    const decision = run(data)

    expect(decision.data).toBe(data)
    expect(decision.held).toBeUndefined()
  })

  it('withholds the fresh release and falls back to the newest eligible version', () => {
    const decision = run(parsed())

    expect(decision.data.latestVersion).toBe('1.1.0')
    expect(decision.data.allVersions).toEqual(['1.1.0', '1.0.0'])
    expect(decision.held).toEqual({
      version: '1.2.0',
      publishedAt: minutesAgo(5),
      ageMinutes: 5,
      count: 1,
    })
    expect(decision.withheldTotal).toBe(1)
  })

  it('treats a version published exactly at the cutoff as eligible', () => {
    const data = parsed({ publishTimes: { '1.2.0': minutesAgo(WINDOW) } })

    const decision = run(data)

    expect(decision.data).toBe(data)
  })

  it('drops the health signals when the cooldown moves the latest', () => {
    // deprecated/enginesNode describe 1.2.0. Re-stamping them onto 1.1.0 would
    // attribute a warning to a version it was never about.
    const decision = run(parsed({ deprecated: 'use 2.x', enginesNode: '>=20' }))

    expect(decision.data.latestVersion).toBe('1.1.0')
    expect(decision.data.deprecated).toBeUndefined()
    expect(decision.data.enginesNode).toBeUndefined()
  })

  it('keeps the health signals when only a version below the latest was withheld', () => {
    const data = parsed({
      latestVersion: '2.0.0',
      allVersions: ['2.0.0', '1.0.5', '1.0.0'],
      publishTimes: {
        '2.0.0': minutesAgo(10_000),
        '1.0.5': minutesAgo(5), // a fresh backport, not the latest
        '1.0.0': minutesAgo(20_000),
      },
      deprecated: 'really about 2.0.0',
      enginesNode: '>=18',
    })

    const decision = run(data)

    expect(decision.data.latestVersion).toBe('2.0.0')
    expect(decision.data.allVersions).toEqual(['2.0.0', '1.0.0'])
    expect(decision.data.deprecated).toBe('really about 2.0.0')
    expect(decision.data.enginesNode).toBe('>=18')
  })

  it('falls back to the installed version when every release is too young', () => {
    const data = parsed({
      latestVersion: '1.2.0',
      allVersions: ['1.2.0'],
      publishTimes: { '1.2.0': minutesAgo(5) },
    })

    const decision = run(data, { installed: semver.parse('1.0.0') })

    // Nothing to upgrade to (yet) — never a pretend-latest the resolver could pick.
    expect(decision.data.latestVersion).toBe('1.0.0')
    expect(decision.data.allVersions).toEqual([])
  })

  it('falls back to the raw specifier when the installed version is unparsable', () => {
    const data = parsed({
      latestVersion: '1.2.0',
      allVersions: ['1.2.0'],
      publishTimes: { '1.2.0': minutesAgo(5) },
    })

    const decision = run(data, { installed: null, specifier: 'latest' })

    expect(decision.data.latestVersion).toBe('latest')
  })

  describe('prerelease channel', () => {
    const withPrereleases = (): ParsedVersions =>
      parsed({
        latestVersion: '1.1.0',
        allVersions: ['1.1.0', '1.0.0'],
        prereleaseVersions: ['2.0.0-rc.2', '2.0.0-rc.1'],
        publishTimes: {
          '1.1.0': minutesAgo(10_000),
          '1.0.0': minutesAgo(20_000),
          '2.0.0-rc.2': minutesAgo(5),
          '2.0.0-rc.1': minutesAgo(10_000),
        },
      })

    it('gates a fresh prerelease even for a stable install', () => {
      // The same attack, one channel over: gating only the stable pool would leave
      // a compromised prerelease reachable by anyone on that channel.
      const decision = run(withPrereleases(), { installed: semver.parse('1.0.0') })

      expect(decision.data.prereleaseVersions).toEqual(['2.0.0-rc.1'])
      expect(decision.withheldTotal).toBe(1)
    })

    it('does not report that hold to a stable install', () => {
      // A stable install is never offered 2.0.0-rc.2, so calling it "held back"
      // would invent an upgrade that was never on the table.
      const decision = run(withPrereleases(), { installed: semver.parse('1.0.0') })

      expect(decision.held).toBeUndefined()
      expect(decision.data.latestVersion).toBe('1.1.0')
    })

    it('does report it to a prerelease install', () => {
      const decision = run(withPrereleases(), { installed: semver.parse('2.0.0-rc.1') })

      expect(decision.held).toMatchObject({ version: '2.0.0-rc.2', count: 1 })
    })

    it('reports the newest withheld version across both channels for a prerelease install', () => {
      const data = parsed({
        latestVersion: '3.0.0',
        allVersions: ['3.0.0', '1.0.0'],
        prereleaseVersions: ['2.0.0-rc.2'],
        publishTimes: {
          '3.0.0': minutesAgo(5),
          '1.0.0': minutesAgo(20_000),
          '2.0.0-rc.2': minutesAgo(10),
        },
      })

      const decision = run(data, { installed: semver.parse('2.0.0-rc.1') })

      // 3.0.0 > 2.0.0-rc.2, and both were withheld.
      expect(decision.held).toMatchObject({ version: '3.0.0', count: 2 })
      expect(decision.withheldTotal).toBe(2)
    })

    it('never falls back onto the prerelease pool when the stable channel empties', () => {
      const data = parsed({
        latestVersion: '2.0.0',
        allVersions: ['2.0.0'],
        prereleaseVersions: ['3.0.0-rc.1'],
        publishTimes: {
          '2.0.0': minutesAgo(5),
          '3.0.0-rc.1': minutesAgo(20_000),
        },
      })

      const decision = run(data, { installed: semver.parse('1.0.0') })

      // 3.0.0-rc.1 is old enough, but a stable install must not be pushed onto
      // the prerelease channel by a cooldown.
      expect(decision.data.latestVersion).toBe('1.0.0')
    })

    it('recomputes on the prerelease channel for a prerelease-only package', () => {
      const data = parsed({
        latestVersion: '1.0.0-rc.3',
        allVersions: [],
        prereleaseVersions: ['1.0.0-rc.3', '1.0.0-rc.2', '1.0.0-rc.1'],
        publishTimes: {
          '1.0.0-rc.3': minutesAgo(5),
          '1.0.0-rc.2': minutesAgo(10_000),
          '1.0.0-rc.1': minutesAgo(20_000),
        },
      })

      const decision = run(data, { installed: semver.parse('1.0.0-rc.1') })

      expect(decision.data.latestVersion).toBe('1.0.0-rc.2')
      expect(decision.held).toMatchObject({ version: '1.0.0-rc.3' })
    })

    it('keeps an absent prerelease pool absent rather than inventing an empty one', () => {
      const decision = run(parsed({ prereleaseVersions: undefined }))

      expect(decision.data.prereleaseVersions).toBeUndefined()
    })
  })

  it('clamps a future publish time to age zero instead of reporting a negative age', () => {
    // A registry clock ahead of ours: correctly withheld, but "-7m ago" is nonsense.
    const data = parsed({
      allVersions: ['1.2.0'],
      publishTimes: { '1.2.0': new Date(NOW + 7 * 60_000).toISOString() },
    })

    const decision = run(data)

    expect(decision.held?.ageMinutes).toBe(0)
  })

  it('counts every withheld version, not just the newest', () => {
    const data = parsed({
      allVersions: ['1.3.0', '1.2.0', '1.0.0'],
      publishTimes: {
        '1.3.0': minutesAgo(1),
        '1.2.0': minutesAgo(5),
        '1.0.0': minutesAgo(20_000),
      },
    })

    const decision = run(data)

    expect(decision.held).toMatchObject({ version: '1.3.0', count: 2 })
  })

  it('withholds a version whose publish time is unknown only when the time is parsable', () => {
    // Positive evidence only: a missing or garbage timestamp keeps the version eligible.
    const data = parsed({
      allVersions: ['1.3.0', '1.2.0', '1.1.0'],
      publishTimes: { '1.3.0': 'not-a-date', '1.2.0': minutesAgo(5) },
    })

    const decision = run(data)

    expect(decision.data.allVersions).toEqual(['1.3.0', '1.1.0'])
    expect(decision.held).toMatchObject({ version: '1.2.0', count: 1 })
  })
})

describe('packagesWithHolds', () => {
  const held = { version: '2.0.0', publishedAt: minutesAgo(5), ageMinutes: 5, count: 1 }

  it('keeps every declaration site, in order, narrowed to a present hold', () => {
    const packages = [
      { name: 'a', isOutdated: false, heldByCooldown: held },
      { name: 'b', isOutdated: true },
      { name: 'a', isOutdated: false, heldByCooldown: held },
    ]

    const result = packagesWithHolds(packages)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.heldByCooldown.version)).toEqual(['2.0.0', '2.0.0'])
  })

  it('is empty when nothing was held', () => {
    expect(packagesWithHolds([{ name: 'a', isOutdated: true }])).toEqual([])
  })
})

describe('countHeldPackages', () => {
  const held = { version: '2.0.0', publishedAt: minutesAgo(5), ageMinutes: 5, count: 1 }

  it('counts unique names, so a workspace-wide hold is one thing to review', () => {
    const packages = [
      { name: 'axios', isOutdated: false, heldByCooldown: held },
      { name: 'axios', isOutdated: false, heldByCooldown: held },
      { name: 'axios', isOutdated: false, heldByCooldown: held },
    ]

    expect(countHeldPackages(packages)).toBe(1)
  })

  it('hiddenOnly drops packages that already have a row of their own', () => {
    const packages = [
      { name: 'fully-held', isOutdated: false, heldByCooldown: held },
      { name: 'partially-held', isOutdated: true, heldByCooldown: held },
      { name: 'plain', isOutdated: true },
    ]

    expect(countHeldPackages(packages)).toBe(2)
    expect(countHeldPackages(packages, { hiddenOnly: true })).toBe(1)
  })

  it('is zero when the cooldown held nothing', () => {
    expect(countHeldPackages([{ name: 'a', isOutdated: true }])).toBe(0)
    expect(countHeldPackages([])).toBe(0)
  })
})

describe('buildCooldownHold', () => {
  it('describes the first (newest) entry and counts the rest', () => {
    const hold = buildCooldownHold(
      [
        { version: '2.0.0', publishedAt: minutesAgo(5) },
        { version: '1.9.0', publishedAt: minutesAgo(30) },
      ],
      NOW
    )

    expect(hold).toEqual({
      version: '2.0.0',
      publishedAt: minutesAgo(5),
      ageMinutes: 5,
      count: 2,
    })
  })

  it('returns undefined for an empty set rather than a zero-count sentinel', () => {
    expect(buildCooldownHold([], NOW)).toBeUndefined()
  })
})
