import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'

type DebugLoggerModule = typeof import('../../../src/shared/debug-logger')

let logger: DebugLoggerModule
let stderr: ReturnType<typeof vi.spyOn>

// The logger keeps module-level state (_enabled, _logFile), so each test gets
// a fresh module instance. Log files land in the real OS temp dir — the same
// place the production code writes — so unique markers keep assertions safe
// even when a previous day's log already exists.
beforeEach(async () => {
  vi.resetModules()
  logger = await import('../../../src/shared/debug-logger')
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  stderr.mockRestore()
})

const uniqueContext = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('debug logger lifecycle', () => {
  it('starts disabled with no log file allocated', () => {
    expect(logger.isDebugEnabled()).toBe(false)
    expect(logger.getDebugLogPath()).toBeNull()
  })

  it('stays inert while disabled', () => {
    logger.debugLog.info('ctx', 'message')

    expect(logger.getDebugLogPath()).toBeNull()
  })

  it('enables logging, announces the path, and writes a header', () => {
    logger.enableDebugLogging()

    expect(logger.isDebugEnabled()).toBe(true)
    const path = logger.getDebugLogPath()
    expect(path).toMatch(/inup-debug-\d{4}-\d{2}-\d{2}\.log$/)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(path!))
    expect(readFileSync(path!, 'utf8')).toContain('=== inup debug log started at')
  })
})

describe('debug log lines', () => {
  it('writes level, context, and message', () => {
    logger.enableDebugLogging()
    const ctx = uniqueContext()

    logger.debugLog.info(ctx, 'information')
    logger.debugLog.warn(ctx, 'warning')
    logger.debugLog.error(ctx, 'failure')

    const content = readFileSync(logger.getDebugLogPath()!, 'utf8')
    expect(content).toContain(`[INFO] [${ctx}] information`)
    expect(content).toContain(`[WARN] [${ctx}] warning`)
    expect(content).toContain(`[ERROR] [${ctx}] failure`)
  })

  it('appends error details with a truncated stack', () => {
    logger.enableDebugLogging()
    const ctx = uniqueContext()

    logger.debugLog.error(ctx, 'exploded', new TypeError('boom'))

    const content = readFileSync(logger.getDebugLogPath()!, 'utf8')
    expect(content).toContain(`[${ctx}] exploded | TypeError: boom | `)
  })

  it('serializes object extras as JSON', () => {
    logger.enableDebugLogging()
    const ctx = uniqueContext()

    logger.debugLog.info(ctx, 'with data', { packages: 3 })

    expect(readFileSync(logger.getDebugLogPath()!, 'utf8')).toContain(
      `[${ctx}] with data | {"packages":3}`
    )
  })

  it('marks circular structures as unserializable', () => {
    logger.enableDebugLogging()
    const ctx = uniqueContext()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    logger.debugLog.info(ctx, 'loops', circular)

    expect(readFileSync(logger.getDebugLogPath()!, 'utf8')).toContain(
      `[${ctx}] loops | [unserializable]`
    )
  })

  it('appends primitive extras verbatim', () => {
    logger.enableDebugLogging()
    const ctx = uniqueContext()

    logger.debugLog.info(ctx, 'count', 42)

    expect(readFileSync(logger.getDebugLogPath()!, 'utf8')).toContain(`[${ctx}] count | 42`)
  })

  it('reports elapsed milliseconds for perf entries', () => {
    logger.enableDebugLogging()
    const ctx = uniqueContext()

    logger.debugLog.perf(ctx, 'fetch', Date.now() - 150)

    const content = readFileSync(logger.getDebugLogPath()!, 'utf8')
    const match = content.match(new RegExp(`\\[PERF\\] \\[${ctx}\\] fetch — (\\d+)ms`))
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBeGreaterThanOrEqual(150)
  })
})
