import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatAge } from '../../../src/shared/duration'

describe('formatAge', () => {
  it('reads as minutes under an hour', () => {
    expect(formatAge(0)).toBe('0m')
    expect(formatAge(1)).toBe('1m')
    expect(formatAge(59)).toBe('59m')
  })

  it('switches to whole hours at an hour, and to whole days at a day', () => {
    expect(formatAge(60)).toBe('1h')
    expect(formatAge(90)).toBe('1h') // deliberately coarse: "1h 30m" only adds noise
    expect(formatAge(23 * 60 + 59)).toBe('23h')
    expect(formatAge(24 * 60)).toBe('1d')
    expect(formatAge(7 * 24 * 60 + 12 * 60)).toBe('7d')
  })

  it('handles a very old release without scientific notation or overflow', () => {
    expect(formatAge(5 * 365 * 24 * 60)).toBe('1825d')
  })
})

describe('the GitHub Action’s copy of formatAge', () => {
  // The Action runs as bare Node with no build step, so it cannot import from src/ and
  // keeps its own copy. That is a deliberate duplication — this test is what stops the two
  // from drifting, so a hold never reads as "5d ago" in one place and "129h ago" in another.
  //
  // Imported via an explicit file:// URL rather than a relative specifier: Vite's SSR module
  // runner externalizes .mjs files, and on Windows a relative specifier resolves incorrectly.
  const actionModuleUrl = pathToFileURL(join(process.cwd(), 'action/render-pr-body.mjs')).href

  it('agrees with the shared implementation across the whole range', async () => {
    const { formatAge: actionFormatAge } = (await import(actionModuleUrl)) as {
      formatAge: (minutes: number) => string
    }

    const samples = [
      0, 1, 30, 59, 60, 61, 119, 120, 599, 1_439, 1_440, 1_441, 2_880, 10_080, 44_640, 525_600,
    ]
    for (const minutes of samples) {
      expect(actionFormatAge(minutes), `disagreement at ${minutes} minutes`).toBe(
        formatAge(minutes)
      )
    }
  })
})
