import * as readline from 'node:readline'
import { Key } from 'node:readline'

const ESCAPE_CODE_TIMEOUT_MS = 25

type KeypressListener = (str: string, key: Key) => void

export type KeypressSession = {
  close: () => void
}

function isMouseSequence(str: string, key: Key | undefined): boolean {
  const sequence = key?.sequence ?? str
  if (!sequence) {
    return false
  }

  return sequence.startsWith('\x1b[<') || sequence.startsWith('\x1b[M')
}

export const TerminalInput = {
  startKeypressSession(onKeypress: KeypressListener): KeypressSession {
    const rl = readline.createInterface({
      input: process.stdin,
      escapeCodeTimeout: ESCAPE_CODE_TIMEOUT_MS,
      terminal: true,
    })

    readline.emitKeypressEvents(process.stdin, rl)
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    const filteredKeypressListener: KeypressListener = (str, key) => {
      if (isMouseSequence(str, key)) {
        return
      }

      onKeypress(str, key)
    }
    process.stdin.on('keypress', filteredKeypressListener)

    return {
      close: () => {
        process.stdin.off('keypress', filteredKeypressListener)
        rl.close()
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
      },
    }
  },

  promptForConfirmation(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      })

      const finish = (value: boolean) => {
        rl.close()
        resolve(value)
      }

      rl.question(prompt, (answer) => {
        const normalizedAnswer = answer.trim().toLowerCase()
        finish(normalizedAnswer === '' || normalizedAnswer === 'y' || normalizedAnswer === 'yes')
      })

      rl.on('SIGINT', () => finish(false))
    })
  },
}

export const TerminalInputInternals = {
  isMouseSequence,
}
