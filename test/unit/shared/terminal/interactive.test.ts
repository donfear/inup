import { afterEach, describe, expect, it } from 'vitest'
import { isCI, isInteractiveTerminal } from '../../../../src/shared/terminal'

describe('isCI', () => {
  it.each(['true', '1', 'TRUE', 'yes', 'github-actions'])('is on for CI=%s', (value) => {
    expect(isCI({ CI: value })).toBe(true)
  })

  // Create React App setups and some shell profiles export CI=false to opt out.
  it.each([undefined, '', ' ', 'false', 'FALSE', 'False', '0', ' 0 '])(
    'is off for CI=%s',
    (value) => {
      expect(isCI({ CI: value })).toBe(false)
    }
  )

  it('reads process.env by default', () => {
    const original = process.env.CI
    try {
      process.env.CI = 'false'
      expect(isCI()).toBe(false)
      process.env.CI = 'true'
      expect(isCI()).toBe(true)
    } finally {
      if (original === undefined) delete process.env.CI
      else process.env.CI = original
    }
  })
})

describe('isInteractiveTerminal', () => {
  const originalStdin = process.stdin.isTTY
  const originalStdout = process.stdout.isTTY
  const setTTY = (stdin: boolean, stdout: boolean) => {
    Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true })
  }

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdin, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdout, configurable: true })
  })

  it('is interactive when stdin and stdout are terminals outside CI', () => {
    setTTY(true, true)
    expect(isInteractiveTerminal({})).toBe(true)
    expect(isInteractiveTerminal({ CI: 'false' })).toBe(true)
  })

  it('is not interactive when stdin is redirected, e.g. inup < /dev/null', () => {
    setTTY(false, true)
    expect(isInteractiveTerminal({})).toBe(false)
  })

  it('is not interactive when stdout is piped', () => {
    setTTY(true, false)
    expect(isInteractiveTerminal()).toBe(false)
  })

  it('is not interactive in CI', () => {
    setTTY(true, true)
    expect(isInteractiveTerminal({ CI: 'true' })).toBe(false)
  })
})
