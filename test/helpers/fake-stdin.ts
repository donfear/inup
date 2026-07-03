import { PassThrough } from 'node:stream'
import { vi } from 'vitest'

export interface FakeStdin {
  /** The stream standing in for process.stdin. */
  stdin: PassThrough & { isTTY: boolean; setRawMode: ReturnType<typeof vi.fn> }
  /**
   * Write raw bytes to the fake stdin and wait for them to be decoded into
   * keypress events. Real escape sequences work (`'\x1b[B'` → down arrow),
   * but a *bare* ESC byte is only emitted after readline's escapeCodeTimeout
   * (25ms in terminal-input.ts) — prefer letter keys for closing modals, or
   * pass `waitMs` to outlast the timeout.
   */
  sendKeys: (raw: string, waitMs?: number) => Promise<void>
  /** Reinstall the real process.stdin. */
  restore: () => void
}

/**
 * Swap process.stdin for a PassThrough that supports raw mode, so code using
 * readline keypress sessions can be driven end-to-end without a real TTY.
 */
export function installFakeStdin(): FakeStdin {
  const stdin = new PassThrough() as FakeStdin['stdin']
  stdin.isTTY = true
  stdin.setRawMode = vi.fn().mockReturnValue(stdin)

  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    get: () => stdin,
  })

  const sendKeys = async (raw: string, waitMs = 0): Promise<void> => {
    stdin.write(raw)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    await new Promise((resolve) => setImmediate(resolve))
  }

  const restore = () => {
    if (originalDescriptor) {
      Object.defineProperty(process, 'stdin', originalDescriptor)
    }
    stdin.removeAllListeners()
  }

  return { stdin, sendKeys, restore }
}
