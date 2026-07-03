import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleUtils, CursorUtils } from '../../../../src/shared/terminal'
import { RAW_EXIT_ALT_SCREEN, RAW_SHOW_CURSOR } from '../../../../src/shared/terminal/cursor'
import { installFakeStdin } from '../../../helpers/fake-stdin'
import { captureStdout } from '../../../helpers/terminal-capture'

// Progress is cosmetic feedback. It must never touch stdout (which is reserved for the
// --json / plain report), and it must stay silent when stderr is redirected to a log.
describe('ConsoleUtils progress output hygiene', () => {
  const originalIsTTY = process.stderr.isTTY

  const setStderrTTY = (value: boolean) =>
    Object.defineProperty(process.stderr, 'isTTY', { value, configurable: true })

  afterEach(() => {
    Object.defineProperty(process.stderr, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it('writes progress to stderr and never to stdout when stderr is a TTY', () => {
    setStderrTTY(true)
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    ConsoleUtils.showProgress('🔍 scanning')
    ConsoleUtils.clearProgress()

    expect(errSpy).toHaveBeenCalled()
    expect(outSpy).not.toHaveBeenCalled()
  })

  it('suppresses progress entirely when stderr is not a TTY', () => {
    setStderrTTY(false)
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    ConsoleUtils.showProgress('🔍 scanning')
    ConsoleUtils.clearProgress()

    expect(errSpy).not.toHaveBeenCalled()
    expect(outSpy).not.toHaveBeenCalled()
  })

  it('overwrites the previous progress line with a carriage-return pad', () => {
    setStderrTTY(true)
    const writes: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stderr.write)

    ConsoleUtils.showProgress('scanning')
    ConsoleUtils.clearProgress()

    expect(writes[0]).toBe(`\r${' '.repeat(ConsoleUtils.LINE_WIDTH)}\rscanning`)
    expect(writes[1]).toBe(`\r${' '.repeat(ConsoleUtils.LINE_WIDTH)}\r`)
  })
})

describe('CursorUtils escape codes', () => {
  it('writes the documented escape sequence for each cursor operation', () => {
    const stdout = captureStdout()
    try {
      CursorUtils.enterAlternateScreen()
      CursorUtils.exitAlternateScreen()
      CursorUtils.hide()
      CursorUtils.show()
      CursorUtils.moveToHome()
      CursorUtils.clearScreen()
      CursorUtils.clearToEndOfScreen()

      expect(stdout.writes).toEqual([
        '\x1b[?1049h',
        RAW_EXIT_ALT_SCREEN,
        '\x1b[?25l',
        RAW_SHOW_CURSOR,
        '\x1b[H',
        '\x1b[2J\x1b[H',
        '\x1b[J',
      ])
    } finally {
      stdout.restore()
    }
  })

  it('cleanup shows the cursor, leaves raw mode, and pauses stdin', () => {
    const fake = installFakeStdin()
    const stdout = captureStdout()
    const pause = vi.spyOn(fake.stdin, 'pause')
    try {
      CursorUtils.cleanup()

      expect(stdout.writes).toEqual([RAW_SHOW_CURSOR])
      expect(fake.stdin.setRawMode).toHaveBeenCalledWith(false)
      expect(pause).toHaveBeenCalled()
    } finally {
      stdout.restore()
      fake.restore()
    }
  })

  it('cleanup tolerates a stdin without raw mode support', () => {
    const fake = installFakeStdin()
    const stdout = captureStdout()
    fake.stdin.setRawMode = undefined as unknown as typeof fake.stdin.setRawMode
    try {
      CursorUtils.cleanup()

      expect(stdout.writes).toEqual([RAW_SHOW_CURSOR])
    } finally {
      stdout.restore()
      fake.restore()
    }
  })
})
