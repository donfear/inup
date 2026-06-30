import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, isAbsolute, join, resolve } from 'path'
import { DEFAULT_TUNING } from '../../../services/http/adaptive-controller'
import type { PerformanceSnapshot } from '../types/debug.types'

/**
 * Performance debug logger.
 *
 * When INUP_PERF=1, every run writes ONE self-contained JSON file capturing the
 * full configuration plus the performance snapshot (phases, batches, adaptive
 * control ticks, counts). The files accumulate in a gitignored directory so a
 * series of runs can be diffed to find the best-performing configuration.
 *
 * Output location:
 *  - Default: `<cwd>/.inup-perf` (logs next to the project being scanned).
 *  - INUP_PERF_DIR=<path>: a single centralized directory (e.g. the inup repo)
 *    so runs from many different projects collect in one place for analysis.
 *    The project name is encoded into each filename so they stay distinct.
 *
 * Each file is independent: it records every input that could affect timing, so
 * a run can be understood (and reproduced) without external context.
 */

const PERF_DIR_NAME = '.inup-perf'

/** Filesystem-safe slug of a project name for use in filenames. */
function projectSlug(cwd: string): string {
  const name = basename(resolve(cwd)) || 'root'
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)
}

export interface PerfRunConfig {
  /** Where the scan ran. */
  cwd: string
  packageManager: string | null
  /** Resolved adaptive flag for this run. */
  adaptive: boolean
  /** Effective concurrency starting point passed to the fetcher. */
  maxConcurrency: number
  /** Pool ceiling / controller ceiling in effect. */
  poolConnections: number
  /** Emission batch size used for UI grouping. */
  batchSize: number
  /** Entry path: interactive TUI vs headless (json/check/plain). */
  mode: 'interactive' | 'headless'
  /** Relevant env toggles, captured verbatim for reproducibility. */
  env: Record<string, string | undefined>
}

export interface PerfRunRecord {
  schemaVersion: number
  /** ISO timestamp the file was written. */
  timestamp: string
  /** Wall-clock time for the whole tracked run, in ms. */
  wallMs: number | null
  config: PerfRunConfig
  /** Tuning constants in effect when adaptive is on (for cross-run comparison). */
  tuning: typeof DEFAULT_TUNING
  snapshot: PerformanceSnapshot
}

export function isPerfLoggingEnabled(): boolean {
  return process.env.INUP_PERF === '1'
}

/** Capture the env toggles that influence a run, for reproducibility. */
export function perfEnv(): Record<string, string | undefined> {
  return {
    INUP_ADAPTIVE: process.env.INUP_ADAPTIVE,
    INUP_PERF: process.env.INUP_PERF,
    INUP_DEBUG: process.env.INUP_DEBUG,
    CI: process.env.CI,
    NODE_ENV: process.env.NODE_ENV,
  }
}

/**
 * Resolve (and lazily create) the perf-log directory.
 *
 * - INUP_PERF_DIR set → that directory verbatim (centralized collection point,
 *   e.g. the inup repo's .inup-perf). Relative paths resolve from cwd.
 * - otherwise → `<cwd>/.inup-perf` (logs sit next to the scanned project).
 */
export function getPerfDir(cwd: string = process.cwd()): string {
  const override = process.env.INUP_PERF_DIR
  const dir = override
    ? isAbsolute(override)
      ? override
      : resolve(cwd, override)
    : join(cwd, PERF_DIR_NAME)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function fileStamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  )
}

/**
 * Write one perf record to its own JSON file. Best-effort: never throws into the
 * caller (a debugging aid must not break a real run). Returns the path written,
 * or null if disabled or on failure.
 */
export function writePerfLog(config: PerfRunConfig, snapshot: PerformanceSnapshot): string | null {
  if (!isPerfLoggingEnabled()) return null

  try {
    const now = new Date()
    const record: PerfRunRecord = {
      schemaVersion: 1,
      timestamp: now.toISOString(),
      wallMs: snapshot.totalMs,
      config,
      tuning: DEFAULT_TUNING,
      snapshot,
    }

    const dir = getPerfDir(config.cwd)
    const modeTag = config.mode
    const adaptiveTag = config.adaptive ? 'adaptive' : 'fixed'
    // Project name in the filename keeps multi-project runs distinct when many
    // collect into one centralized INUP_PERF_DIR.
    const fileName = `run-${fileStamp(now)}-${projectSlug(config.cwd)}-${adaptiveTag}-${modeTag}.json`
    const filePath = join(dir, fileName)
    writeFileSync(filePath, JSON.stringify(record, null, 2))

    // Maintain a stable pointer to the most recent run for quick reads.
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(record, null, 2))
    // And a cheap one-line-per-run index for fast scanning.
    appendPerfIndex(config.cwd, record)

    if (process.env.INUP_DEBUG === '1') {
      process.stderr.write(`[inup] perf log → ${filePath}\n`)
    }
    return filePath
  } catch {
    // Never let perf logging affect the run.
    return null
  }
}

/** Read every run record in the perf dir, newest first. For the report tool. */
export function readPerfRuns(cwd: string = process.cwd()): PerfRunRecord[] {
  // Honors INUP_PERF_DIR so the report reads the same centralized location runs
  // were written to.
  const dir = getPerfDir(cwd)
  if (!existsSync(dir)) return []
  const records: PerfRunRecord[] = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('run-') || !name.endsWith('.json')) continue
    try {
      records.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as PerfRunRecord)
    } catch {
      // Skip unreadable/partial files.
    }
  }
  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

/** Append a single line to a NDJSON index for ultra-cheap scanning, best-effort. */
export function appendPerfIndex(cwd: string, record: PerfRunRecord): void {
  try {
    const line =
      JSON.stringify({
        timestamp: record.timestamp,
        wallMs: record.wallMs,
        adaptive: record.config.adaptive,
        mode: record.config.mode,
        uniquePackages: record.snapshot.counts.uniquePackages,
        registryFetch: record.snapshot.phases.registryFetch,
        controlTicks: record.snapshot.controlTicks.length,
      }) + '\n'
    appendFileSync(join(getPerfDir(cwd), 'index.ndjson'), line)
  } catch {
    /* best-effort */
  }
}
