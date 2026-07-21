import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPerfDir,
  isPerfLoggingEnabled,
  type PerfRunConfig,
  perfEnv,
  writePerfLog,
} from '../../../../src/features/debug'
import { makeSnapshot } from '../../../fixtures/performance-snapshot-factory'

let tempDir: string

function makeConfig(overrides?: Partial<PerfRunConfig>): PerfRunConfig {
  return {
    cwd: tempDir,
    packageManager: 'pnpm',
    adaptive: true,
    maxConcurrency: 8,
    poolConnections: 16,
    batchSize: 20,
    mode: 'interactive',
    env: perfEnv(),
    ...overrides,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'inup-perf-test-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('isPerfLoggingEnabled', () => {
  it('is only enabled when INUP_PERF is exactly "1"', () => {
    vi.stubEnv('INUP_PERF', '1')
    expect(isPerfLoggingEnabled()).toBe(true)

    vi.stubEnv('INUP_PERF', 'true')
    expect(isPerfLoggingEnabled()).toBe(false)

    vi.stubEnv('INUP_PERF', '')
    expect(isPerfLoggingEnabled()).toBe(false)
  })
})

describe('perfEnv', () => {
  it('captures the run-affecting environment toggles', () => {
    vi.stubEnv('INUP_ADAPTIVE', '0')
    vi.stubEnv('INUP_PERF', '1')

    expect(perfEnv()).toMatchObject({ INUP_ADAPTIVE: '0', INUP_PERF: '1' })
    expect(Object.keys(perfEnv())).toEqual([
      'INUP_ADAPTIVE',
      'INUP_CONTROLLER',
      'INUP_NET_PROFILE',
      'INUP_PERF',
      'INUP_DEBUG',
      'CI',
      'NODE_ENV',
    ])
  })
})

describe('getPerfDir', () => {
  it('defaults to .inup-perf inside the scanned project', () => {
    const dir = getPerfDir(tempDir)

    expect(dir).toBe(join(tempDir, '.inup-perf'))
    expect(existsSync(dir)).toBe(true)
  })

  it('uses an absolute INUP_PERF_DIR verbatim', () => {
    const central = join(tempDir, 'central')
    vi.stubEnv('INUP_PERF_DIR', central)

    expect(getPerfDir(tempDir)).toBe(central)
    expect(existsSync(central)).toBe(true)
  })

  it('resolves a relative INUP_PERF_DIR from the scanned cwd', () => {
    vi.stubEnv('INUP_PERF_DIR', 'perf-here')

    expect(getPerfDir(tempDir)).toBe(resolve(tempDir, 'perf-here'))
  })
})

describe('writePerfLog', () => {
  it('returns null and writes nothing when disabled', () => {
    vi.stubEnv('INUP_PERF', '')

    expect(writePerfLog(makeConfig(), makeSnapshot())).toBeNull()
    expect(existsSync(join(tempDir, '.inup-perf'))).toBe(false)
  })

  it('writes a self-contained run record', () => {
    vi.stubEnv('INUP_PERF', '1')
    const snapshot = makeSnapshot({ totalMs: 1234, counts: { uniquePackages: 42 } })

    const filePath = writePerfLog(makeConfig(), snapshot)

    expect(filePath).not.toBeNull()
    const record = JSON.parse(readFileSync(filePath!, 'utf8'))
    expect(record.schemaVersion).toBe(1)
    expect(record.wallMs).toBe(1234)
    expect(record.config.packageManager).toBe('pnpm')
    expect(record.tuning).toBeDefined()
    expect(record.snapshot.counts.uniquePackages).toBe(42)
  })

  it('encodes the project slug and run mode into the filename', () => {
    vi.stubEnv('INUP_PERF', '1')

    const filePath = writePerfLog(makeConfig({ adaptive: false, mode: 'headless' }), makeSnapshot())

    expect(filePath).toMatch(/run-\d{8}-\d{6}-\d{3}-inup-perf-test-.*-fixed-headless\.json$/)
  })

  it('slugs the filesystem root as "root"', () => {
    vi.stubEnv('INUP_PERF', '1')
    vi.stubEnv('INUP_PERF_DIR', tempDir)

    const filePath = writePerfLog(makeConfig({ cwd: '/' }), makeSnapshot())

    expect(filePath).toMatch(/-root-adaptive-interactive\.json$/)
  })

  it('maintains a latest.json pointer and appends an ndjson index line per run', async () => {
    vi.stubEnv('INUP_PERF', '1')

    const first = writePerfLog(makeConfig(), makeSnapshot({ totalMs: 1 }))
    // Filenames are millisecond-stamped — space the runs apart.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = writePerfLog(makeConfig(), makeSnapshot({ totalMs: 2 }))

    expect(first).not.toBe(second)
    const dir = join(tempDir, '.inup-perf')
    const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'))
    expect(latest.wallMs).toBe(2)

    const indexLines = readFileSync(join(dir, 'index.ndjson'), 'utf8').trim().split('\n')
    expect(indexLines).toHaveLength(2)
    expect(JSON.parse(indexLines[0])).toMatchObject({ wallMs: 1, adaptive: true })
    expect(JSON.parse(indexLines[1])).toMatchObject({ wallMs: 2, mode: 'interactive' })

    expect(readdirSync(dir).filter((f) => f.startsWith('run-'))).toHaveLength(2)
  })

  it('announces the log path on stderr when INUP_DEBUG is set', () => {
    vi.stubEnv('INUP_PERF', '1')
    vi.stubEnv('INUP_DEBUG', '1')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const filePath = writePerfLog(makeConfig(), makeSnapshot())

      expect(stderr).toHaveBeenCalledWith(expect.stringContaining(filePath!))
    } finally {
      stderr.mockRestore()
    }
  })

  it('never throws when the perf directory is unwritable', () => {
    vi.stubEnv('INUP_PERF', '1')
    const blocker = join(tempDir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    vi.stubEnv('INUP_PERF_DIR', join(blocker, 'nested'))

    expect(writePerfLog(makeConfig(), makeSnapshot())).toBeNull()
  })
})
