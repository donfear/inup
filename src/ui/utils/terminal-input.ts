import * as readline from 'node:readline'
import { Key } from 'node:readline'

const ESCAPE_CODE_TIMEOUT_MS = 25

type KeypressListener = (str: string, key: Key) => void

export type KeypressSession = {
  close: () => void
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
    process.stdin.on('keypress', onKeypress)

    return {
      close: () => {
        process.stdin.off('keypress', onKeypress)
        rl.close()
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
      },
    }
  },

  promptForConfirmation(prompt: string, defaultValue = true): Promise<boolean> {
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
        if (normalizedAnswer === '') {
          finish(defaultValue)
          return
        }

        finish(normalizedAnswer === 'y' || normalizedAnswer === 'yes')
      })

      rl.on('SIGINT', () => finish(false))
    })
  },
}
