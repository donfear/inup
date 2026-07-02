import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleUtils } from '../../../../src/shared/terminal'

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
})
