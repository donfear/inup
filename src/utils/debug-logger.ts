import { appendFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let _enabled = false
let _logFile: string | null = null

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function timestamp(): string {
  const d = new Date()
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

function getLogFile(): string {
  if (!_logFile) {
    const d = new Date()
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    _logFile = join(`inup-debug-${dateStr}.log`)
    // Write a header so the file is easy to identify
    writeFileSync(_logFile, `=== inup debug log started at ${timestamp()} ===\n`, { flag: 'a' })
  }
  return _logFile
}

export function enableDebugLogging(): void {
  _enabled = true
  const file = getLogFile()
  // Print the path so the user knows where to look
  process.stderr.write(`[inup] debug logging enabled → ${file}\n`)
}

export function isDebugEnabled(): boolean {
  return _enabled
}

export function getDebugLogPath(): string | null {
  return _logFile
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'PERF'

function write(level: LogLevel, context: string, message: string, extra?: unknown): void {
  if (!_enabled) return

  let line = `[${timestamp()}] [${level}] [${context}] ${message}`
  if (extra !== undefined) {
    if (extra instanceof Error) {
      line += ` | ${extra.name}: ${extra.message}`
      if (extra.stack) {
        const stackLines = extra.stack.split('\n').slice(1, 4).join(' | ')
        line += ` | ${stackLines}`
      }
    } else if (typeof extra === 'object') {
      try {
        line += ` | ${JSON.stringify(extra)}`
      } catch {
        line += ` | [unserializable]`
      }
    } else {
      line += ` | ${extra}`
    }
  }
  line += '\n'

  try {
    appendFileSync(getLogFile(), line)
  } catch {
    // Never crash the app because of debug logging
  }
}

export const debugLog = {
  info: (context: string, message: string, extra?: unknown) => write('INFO', context, message, extra),
  warn: (context: string, message: string, extra?: unknown) => write('WARN', context, message, extra),
  error: (context: string, message: string, extra?: unknown) => write('ERROR', context, message, extra),

  /** Log elapsed time since a start timestamp obtained via Date.now() */
  perf: (context: string, label: string, startMs: number, extra?: unknown) => {
    const elapsed = Date.now() - startMs
    write('PERF', context, `${label} — ${elapsed}ms`, extra)
  },
}
