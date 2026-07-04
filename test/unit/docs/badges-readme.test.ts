import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractRepositoryUrl } from '../../../src/features/changelog/parsers/repository-ref'

const README_PATH = join(process.cwd(), 'README.md')
const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json')
const COVERAGE_SUMMARY_PATH = join(process.cwd(), 'coverage', 'coverage-summary.json')
const TEST_RESULTS_PATH = join(process.cwd(), 'coverage', 'test-results.json')
const START = '<!-- TEST-BADGES:START -->'
const END = '<!-- TEST-BADGES:END -->'

// Both files are written by `pnpm test:coverage` *after* the run finishes, so a
// run always checks the previous run's numbers. These caps bound how stale the
// badges may get before this test demands a `pnpm docs:badges` regeneration.
const COVERAGE_DRIFT_PCT = 1
const TEST_COUNT_DRIFT = 50

// The badges link to the CI workflow of whatever repository package.json
// declares — the repo location is never hardcoded here.
function ciWorkflowUrl(): string {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
    repository?: { url?: string }
  }
  return `${extractRepositoryUrl(pkg.repository?.url ?? '')}/actions/workflows/ci.yml`
}

// Measured value rounded to one decimal, with a trailing '.0' dropped:
// 97.53 → '97.5%', 100 → '100%'.
function formatPct(pct: number): string {
  return `${Number(pct.toFixed(1))}%`
}

function renderTestBadges(testCount: number, linesPct: number): string {
  const pct = encodeURIComponent(formatPct(linesPct))
  const ci = ciWorkflowUrl()
  return [
    `[![Tests](https://img.shields.io/badge/tests-${testCount}_passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](${ci})`,
    `[![Coverage](https://img.shields.io/badge/coverage-${pct}-brightgreen?style=for-the-badge)](${ci})`,
  ].join('\n')
}

function readBadgesRegion(readme: string): string {
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1) {
    throw new Error('TEST-BADGES markers not found in README.md')
  }
  return readme
    .slice(start + START.length, end)
    .replace(/\r\n/g, '\n')
    .trim()
}

describe('readme test badges', () => {
  // Run `pnpm docs:badges` to regenerate the badges from a fresh coverage run.
  // The drift assertions only run on CI (where the workflow re-runs this file
  // right after a fresh coverage run) or during an explicit regeneration — a
  // plain local `pnpm test` must never fail on week-old coverage artifacts
  // that happen to sit in the working tree.
  it('README test badges stay in sync with measured coverage and test count', () => {
    if (!existsSync(COVERAGE_SUMMARY_PATH)) return // needs a prior `pnpm test:coverage`
    if (!process.env.CI && !process.env.UPDATE_README) return

    const linesPct: number = JSON.parse(readFileSync(COVERAGE_SUMMARY_PATH, 'utf-8')).total.lines
      .pct
    const testCount: number | undefined = existsSync(TEST_RESULTS_PATH)
      ? JSON.parse(readFileSync(TEST_RESULTS_PATH, 'utf-8')).numPassedTests
      : undefined

    if (process.env.UPDATE_README) {
      if (testCount === undefined) {
        throw new Error('coverage/test-results.json not found — run `pnpm test:coverage` first')
      }
      const readme = readFileSync(README_PATH, 'utf-8')
      const start = readme.indexOf(START)
      const end = readme.indexOf(END)
      if (start === -1 || end === -1) {
        throw new Error('TEST-BADGES markers not found in README.md')
      }
      const updated =
        readme.slice(0, start + START.length) +
        '\n' +
        renderTestBadges(testCount, linesPct) +
        '\n' +
        readme.slice(end)
      writeFileSync(README_PATH, updated, 'utf-8')
    }

    const region = readBadgesRegion(readFileSync(README_PATH, 'utf-8'))

    const badgePct = Number(/badge\/coverage-([\d.]+)%25/.exec(region)?.[1])
    expect(badgePct).toBeGreaterThan(0)
    expect(Math.abs(badgePct - linesPct)).toBeLessThan(COVERAGE_DRIFT_PCT)

    // The badges must link to this repository's CI, not a hardcoded one.
    expect(region).toContain(`](${ciWorkflowUrl()})`)

    if (testCount !== undefined) {
      const badgeCount = Number(/badge\/tests-(\d+)_passing/.exec(region)?.[1])
      expect(badgeCount).toBeGreaterThan(0)
      // Symmetric staleness bound: adding or removing a handful of tests must
      // not fail CI, but large drift demands a `pnpm docs:badges` regeneration.
      expect(Math.abs(testCount - badgeCount)).toBeLessThanOrEqual(TEST_COUNT_DRIFT)
    }
  })
})
