import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Key } from 'node:readline'
import { TerminalInput } from '../../../../src/shared/terminal/terminal-input'
import { installFakeStdin, type FakeStdin } from '../../../helpers/fake-stdin'
import { captureStdout, type TerminalCapture } from '../../../helpers/terminal-capture'

let fake: FakeStdin
let stdout: TerminalCapture

beforeEach(() => {
  fake = installFakeStdin()
  stdout = captureStdout()
})

afterEach(() => {
  stdout.restore()
  fake.restore()
})

describe('startKeypressSession', () => {
  it('enables raw mode and decodes escape sequences into named keys', async () => {
    const received: Array<{ str: string; key: Key }> = []
    const session = TerminalInput.startKeypressSession((str, key) => received.push({ str, key }))

    expect(fake.stdin.setRawMode).toHaveBeenCalledWith(true)

    await fake.sendKeys('\x1b[A')
    await fake.sendKeys('x')

    expect(received.map(({ key }) => key.name)).toEqual(['up', 'x'])
    expect(received[1].str).toBe('x')

    session.close()
  })

  it('close() removes the listener, leaves raw mode, and pauses stdin', async () => {
    const onKeypress = vi.fn()
    const session = TerminalInput.startKeypressSession(onKeypress)
    const pause = vi.spyOn(fake.stdin, 'pause')

    session.close()

    expect(fake.stdin.listenerCount('keypress')).toBe(0)
    expect(fake.stdin.setRawMode).toHaveBeenLastCalledWith(false)
    expect(pause).toHaveBeenCalled()

    await fake.sendKeys('x')
    expect(onKeypress).not.toHaveBeenCalled()
  })

  it('skips raw mode when the stream does not support it', () => {
    // Simulate a non-TTY stdin (e.g. piped input) without setRawMode.
    fake.stdin.setRawMode = undefined as unknown as FakeStdin['stdin']['setRawMode']

    const session = TerminalInput.startKeypressSession(vi.fn())
    session.close()
  })
})

describe('promptForConfirmation', () => {
  it('resolves true for y and yes answers', async () => {
    const promise = TerminalInput.promptForConfirmation('Proceed? ')
    await fake.sendKeys('y\n')
    await expect(promise).resolves.toBe(true)

    const promise2 = TerminalInput.promptForConfirmation('Proceed? ')
    await fake.sendKeys('YES\n')
    await expect(promise2).resolves.toBe(true)
  })

  it('resolves false for anything else', async () => {
    const promise = TerminalInput.promptForConfirmation('Proceed? ')
    await fake.sendKeys('nope\n')
    await expect(promise).resolves.toBe(false)
  })

  it('resolves the default for an empty answer', async () => {
    const promise = TerminalInput.promptForConfirmation('Proceed? ', true)
    await fake.sendKeys('\n')
    await expect(promise).resolves.toBe(true)

    const promise2 = TerminalInput.promptForConfirmation('Proceed? ', false)
    await fake.sendKeys('\n')
    await expect(promise2).resolves.toBe(false)
  })

  it('writes the prompt to stdout', async () => {
    const promise = TerminalInput.promptForConfirmation('Proceed? ')
    await fake.sendKeys('y\n')
    await promise

    expect(stdout.output()).toContain('Proceed? ')
  })

  it('resolves false when interrupted with Ctrl+C', async () => {
    const promise = TerminalInput.promptForConfirmation('Proceed? ')
    await fake.sendKeys('\x03')
    await expect(promise).resolves.toBe(false)
  })
})

describe('promptForImmediateConfirmation', () => {
  it('resolves the default on Enter without echoing an answer', async () => {
    const promise = TerminalInput.promptForImmediateConfirmation('Continue? ', true)
    await fake.sendKeys('\r')

    await expect(promise).resolves.toBe(true)
    expect(stdout.output()).toContain('Continue? ')
  })

  it('resolves true on y and false on n, case-insensitively', async () => {
    const yes = TerminalInput.promptForImmediateConfirmation('Continue? ')
    await fake.sendKeys('y')
    await expect(yes).resolves.toBe(true)

    const no = TerminalInput.promptForImmediateConfirmation('Continue? ')
    await fake.sendKeys('N')
    await expect(no).resolves.toBe(false)
  })

  it('resolves false on Ctrl+C', async () => {
    const promise = TerminalInput.promptForImmediateConfirmation('Continue? ')
    await fake.sendKeys('\x03')

    await expect(promise).resolves.toBe(false)
  })

  it('ignores unrelated keys until a decision arrives', async () => {
    const promise = TerminalInput.promptForImmediateConfirmation('Continue? ')
    await fake.sendKeys('zq')
    await fake.sendKeys('y')

    await expect(promise).resolves.toBe(true)
  })

  it('falls back to the line prompt when raw mode is unavailable', async () => {
    fake.stdin.setRawMode.mockImplementationOnce(() => {
      throw new Error('no tty')
    })

    const promise = TerminalInput.promptForImmediateConfirmation('Continue? ', true)
    await fake.sendKeys('y\n')

    await expect(promise).resolves.toBe(true)
  })
})

describe('promptForImmediateConfirmation fallback failure', () => {
  it('resolves false when even the line prompt fails', async () => {
    fake.stdin.setRawMode.mockImplementationOnce(() => {
      throw new Error('no tty')
    })
    const promptSpy = vi
      .spyOn(TerminalInput, 'promptForConfirmation')
      .mockRejectedValue(new Error('stdin gone'))

    try {
      await expect(TerminalInput.promptForImmediateConfirmation('Continue? ')).resolves.toBe(false)
    } finally {
      promptSpy.mockRestore()
    }
  })
})
