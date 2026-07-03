import { vi } from 'vitest'

export interface TerminalCapture {
  /** Everything written so far, concatenated. */
  output: () => string
  /** Individual write payloads. */
  writes: string[]
  /** Forget everything captured so far. */
  clear: () => void
  /** Restore the real stream properties and stop capturing. */
  restore: () => void
}

interface CaptureOptions {
  columns?: number
  rows?: number
  isTTY?: boolean
}

function capture(stream: NodeJS.WriteStream, options: CaptureOptions): TerminalCapture {
  const writes: string[] = []
  const writeSpy = vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  }) as typeof stream.write)

  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries(options)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(stream, key))
    Object.defineProperty(stream, key, { configurable: true, value })
  }

  return {
    writes,
    output: () => writes.join(''),
    clear: () => {
      writes.length = 0
    },
    restore: () => {
      writeSpy.mockRestore()
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) {
          Object.defineProperty(stream, key, descriptor)
        } else {
          delete (stream as unknown as Record<string, unknown>)[key]
        }
      }
    },
  }
}

/** Capture process.stdout writes and optionally fake its terminal geometry. */
export function captureStdout(options: CaptureOptions = {}): TerminalCapture {
  return capture(process.stdout, options)
}

/** Capture process.stderr writes and optionally fake its TTY flag. */
export function captureStderr(options: CaptureOptions = {}): TerminalCapture {
  return capture(process.stderr, options)
}
