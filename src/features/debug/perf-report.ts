/**
 * Perf report reader. Run after collecting runs with INUP_PERF=1:
 *
 *   INUP_PERF=1 inup            # collect a few runs (vary --adaptive / --no-adaptive)
 *   npm run perf:report         # build + tabulate and compare them
 *
 * Reads .inup-perf/ in the current directory and prints:
 *  - one row per run (config + key timings)
 *  - an adaptive-vs-fixed summary so the faster configuration is obvious
 *
 * `perf:report` compiles first (the project is CommonJS) then runs the built JS.
 */
import { readPerfRuns, type PerfRunRecord } from './services/perf-logger'

const num = (v: number | null | undefined, suffix = ''): string =>
  v === null || v === undefined ? '—' : `${Math.round(v)}${suffix}`

const pad = (s: string, w: number): string =>
  s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length)

const padL = (s: string, w: number): string =>
  s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s

function shortTime(iso: string): string {
  // 2026-06-30T10:33:59.474Z -> 06-30 10:33:59
  const m = iso.match(/\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : iso
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function projectName(cwd: string): string {
  const parts = cwd.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || 'root'
}

function row(r: PerfRunRecord): string {
  const c = r.config
  const s = r.snapshot
  const peakLimit = s.controlTicks.length ? Math.max(...s.controlTicks.map((t) => t.limit)) : null
  const hardDowns = s.controlTicks.filter((t) => t.reason === 'hard-down').length
  return [
    pad(shortTime(r.timestamp), 15),
    pad(projectName(c.cwd), 16),
    pad(c.adaptive ? 'adaptive' : 'fixed', 9),
    pad(c.mode, 11),
    padL(String(s.counts.uniquePackages ?? '—'), 4),
    padL(num(s.phases.registryFetch, 'ms'), 9),
    padL(num(s.totalMs ?? r.wallMs, 'ms'), 9),
    padL(num(s.phases.firstBatch, 'ms'), 9),
    padL(String(s.controlTicks.length), 6),
    padL(peakLimit === null ? '—' : String(peakLimit), 5),
    padL(String(hardDowns), 5),
    padL(String(s.failedPackages.length), 5),
  ].join(' ')
}

function header(): string {
  return [
    pad('when', 15),
    pad('project', 16),
    pad('mode', 9),
    pad('entry', 11),
    padL('pkgs', 4),
    padL('regFetch', 9),
    padL('total', 9),
    padL('1stBatch', 9),
    padL('ticks', 6),
    padL('peak', 5),
    padL('hard', 5),
    padL('fail', 5),
  ].join(' ')
}

function summarize(records: PerfRunRecord[], label: string): void {
  const fetches = records
    .map((r) => r.snapshot.phases.registryFetch)
    .filter((v): v is number => typeof v === 'number')
  const totals = records
    .map((r) => r.snapshot.totalMs ?? r.wallMs)
    .filter((v): v is number => typeof v === 'number')
  console.log(
    `  ${pad(label, 10)} n=${records.length}` +
      `  regFetch mean=${num(mean(fetches), 'ms')} median=${num(median(fetches), 'ms')}` +
      `  total mean=${num(mean(totals), 'ms')} median=${num(median(totals), 'ms')}`
  )
}

function main(): void {
  const cwd = process.cwd()
  const records = readPerfRuns(cwd)

  if (records.length === 0) {
    console.log('No perf runs found in .inup-perf/.')
    console.log('Collect some first:  INUP_PERF=1 inup   (try with and without --no-adaptive)')
    return
  }

  console.log(`\nPerf runs in ${cwd}/.inup-perf/  (${records.length} total, newest first)\n`)
  console.log(header())
  console.log('-'.repeat(header().length))
  for (const r of records) console.log(row(r))

  console.log('\nSummary by configuration:')
  summarize(
    records.filter((r) => r.config.adaptive),
    'adaptive'
  )
  summarize(
    records.filter((r) => !r.config.adaptive),
    'fixed'
  )

  // Tail analysis: which individual packages cost the most? Aggregates per-package
  // latency across all runs that captured it (newest runs include packageTimings).
  const byPkg = new Map<string, number[]>()
  for (const r of records) {
    for (const t of r.snapshot.packageTimings ?? []) {
      const arr = byPkg.get(t.name) ?? []
      arr.push(t.latencyMs)
      byPkg.set(t.name, arr)
    }
  }
  if (byPkg.size > 0) {
    const ranked = [...byPkg.entries()]
      .map(([name, lats]) => ({ name, max: Math.max(...lats), avg: mean(lats) ?? 0 }))
      .sort((a, b) => b.max - a.max)
      .slice(0, 15)
    console.log('\nSlowest packages (tail — these set the wall-clock floor):')
    console.log(`  ${pad('package', 32)} ${padL('max', 8)} ${padL('avg', 8)}`)
    for (const p of ranked) {
      console.log(`  ${pad(p.name, 32)} ${padL(num(p.max, 'ms'), 8)} ${padL(num(p.avg, 'ms'), 8)}`)
    }
  }

  // Tuning is identical across runs (compile-time constants); show it once.
  const tuning = records[0].tuning
  console.log(
    `\nAdaptive tuning: floor=${tuning.floor} ceil=${tuning.ceil} +${tuning.increaseStep}/tick ` +
      `soft×${tuning.softDecreaseFactor} hard×${tuning.hardDecreaseFactor} ` +
      `tickEvery=${tuning.ticksEveryCompletions}\n`
  )
}

main()
