// Run from the repository root: pnpm bench (node --expose-gc test/benchmarks/performance.cjs)
// Synthetic, offline fixtures. No user config/cache writes or real installs.
// Every case runs BENCH_RUNS times (default 5); wall and CPU are reported as
// the median with the min-max spread so a single noisy run cannot mislead.
const { performance } = require('node:perf_hooks')
// Benchmarks the compiled output in dist/ (what ships to users); `pnpm bench`
// builds it first. Patching a module's exports works because tsc's CommonJS
// output calls imports through the exports object.
require('chalk').default.level = 0
// Never read or write the real learned network profile.
const { configManager } = require('../../dist/shared/config/user-config.js')
configManager.getNetworkProfile = () => null
configManager.setNetworkProfile = () => {}
require('../../dist/shared/http/etag-store.js').setEtagCacheEnabled(false)
require('../../dist/shared/registry/registry-config.js').registryTargetFor = () => ({
  origin: 'https://benchmark.invalid',
  pathPrefix: '',
})
const { ConsoleUtils } = require('../../dist/shared/terminal/index.js')
ConsoleUtils.showProgress = () => {}
ConsoleUtils.clearProgress = () => {}
let dependencies = []
let responseDelay = () => 0
const versions = Object.fromEntries([
  ['2.0.0', {}],
  ...Array.from({ length: 50 }, (_, i) => [`1.${i}.0`, {}]),
])
const body = Buffer.from(JSON.stringify({ versions }))
require('../../dist/shared/http/http-request.js').httpRequest = async (_origin, { path }) => {
  const delay = responseDelay(path)
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  return {
    statusCode: 200,
    headers: {},
    body: {
      dump: async () => {},
      [Symbol.asyncIterator]: async function* () {
        yield body
      },
    },
  }
}
require('../../dist/shared/fs/scan.js').findAllPackageJsonFilesAsync = async () => [
  `${process.cwd()}/package.json`,
]
require('../../dist/shared/fs/io.js').collectAllDependenciesAsync = async () => dependencies
const { PackageDetector } = require('../../dist/features/upgrade/package-detector.js')
const list = require('../../dist/features/interactive/renderer/package-list/index.js')
// Mirrors test/fixtures/selection-state-factory.ts (plain JS: dist/ has no test fixtures).
const makeSelectionState = (overrides) => ({
  name: 'test-pkg',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^1.0.0',
  currentVersion: '1.0.0',
  rangeVersion: '1.1.0',
  latestVersion: '2.0.0',
  selectedOption: 'none',
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  type: 'dependencies',
  ...overrides,
})
// Present on branches with sorted insertion; the baseline has no such list.
let SelectionList = null
try {
  SelectionList = require('../../dist/features/interactive/session/selection-list.js').SelectionList
} catch {}
const { getPerformanceTracker } = require('../../dist/features/debug/index.js')
const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 5))
const results = []
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >>> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const spread = (values) => Math.max(...values) - Math.min(...values)
async function measure(label, run) {
  const wall = []
  const cpuMs = []
  let details = {}
  let heapDeltaBytes = 0
  let rssBytes = 0
  for (let i = 0; i < RUNS; i++) {
    global.gc?.()
    const memory = process.memoryUsage()
    const cpu = process.cpuUsage()
    const start = performance.now()
    details = await run()
    wall.push(performance.now() - start)
    const usedCpu = process.cpuUsage(cpu)
    cpuMs.push((usedCpu.user + usedCpu.system) / 1000)
    const after = process.memoryUsage()
    heapDeltaBytes = after.heapUsed - memory.heapUsed
    rssBytes = after.rss
  }
  results.push({
    label,
    runs: RUNS,
    wallMs: +median(wall).toFixed(2),
    wallSpreadMs: +spread(wall).toFixed(2),
    cpuMs: +median(cpuMs).toFixed(2),
    cpuSpreadMs: +spread(cpuMs).toFixed(2),
    heapDeltaBytes,
    rssBytes,
    ...details,
  })
}
// Workspaces alternate specifiers so the per-specifier cache sees both hits and misses.
const SPECIFIERS = ['^1.0.0', '~1.2.0', '1.3.0']
function fixture(unique, repeats) {
  return Array.from({ length: unique * repeats }, (_, i) => ({
    name: `pkg-${String(i % unique).padStart(4, '0')}`,
    version: SPECIFIERS[Math.floor(i / unique) % SPECIFIERS.length],
    type: 'dependencies',
    packageJsonPath: `/fixture/workspace-${Math.floor(i / unique)}/package.json`,
  }))
}
async function scan() {
  getPerformanceTracker().start()
  const detector = new PackageDetector({ cwd: process.cwd(), adaptive: false, concurrency: 10 })
  let firstVisibleMs = null
  const start = performance.now()
  const packages = await detector.streamOutdatedPackages((event) => {
    if (
      firstVisibleMs === null &&
      event.type === 'package' &&
      event.payload.packageInfo.some((pkg) => pkg.isOutdated)
    ) {
      firstVisibleMs = +(performance.now() - start).toFixed(2)
    }
  })
  return { firstVisibleMs, occurrences: packages.length }
}
async function main() {
  // Warm module/JIT paths outside measurements; each scan still resolves fresh metadata.
  dependencies = fixture(100, 1)
  await scan()
  for (const repeats of [1, 10, 50]) {
    dependencies = fixture(100, repeats)
    await measure(`resolve-100-packages-${repeats}-workspaces`, scan)
  }
  dependencies = fixture(30, 1)
  for (const slow of ['0000', '0001', '0009']) {
    responseDelay = (path) => (path.endsWith(slow) ? 200 : 2)
    await measure(`stream-slow-package-${slow}`, scan)
  }
  for (const size of [100, 1000, 10000]) {
    const states = Array.from({ length: size }, (_, i) => makeSelectionState({ name: `pkg-${i}` }))
    const layout = list.VersionColumnLayout ? new list.VersionColumnLayout() : null
    const frame = () => {
      const options = layout ? { columnWidths: layout.get(states, 120) } : {}
      return list.renderInterface(
        states,
        0,
        0,
        20,
        undefined,
        undefined,
        false,
        '',
        size,
        120,
        undefined,
        undefined,
        options
      )
    }
    const timed = (run) => {
      const timings = []
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        run(i)
        timings.push(performance.now() - start)
      }
      timings.sort((a, b) => a - b)
      return { medianFrameMs: +timings[50].toFixed(3), p95FrameMs: +timings[95].toFixed(3) }
    }
    for (let i = 0; i < 10; i++) frame()
    // Idle frames: navigation and selection changes over a settled list.
    await measure(`render-${size}-rows`, () => timed(() => frame()))
    // Streaming frames: one row appended per frame, so the layout is remeasured.
    await measure(`render-${size}-rows-appending`, () =>
      timed((i) => {
        states.push(makeSelectionState({ name: `late-${i}` }))
        frame()
      })
    )
  }
  // Sorted insertion of every row in scrambled arrival order.
  for (const size of SelectionList ? [1000, 10000] : []) {
    const rows = Array.from({ length: size }, (_, i) =>
      makeSelectionState({ name: `${i % 5 === 0 ? '@s/' : ''}pkg-${String(i).padStart(5, '0')}` })
    )
    for (let i = rows.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1)
      ;[rows[i], rows[j]] = [rows[j], rows[i]]
    }
    await measure(`insert-sorted-${size}-rows`, () => {
      const selection = new SelectionList()
      for (const row of rows) selection.insert([row])
      return { rows: selection.length }
    })
  }
  if (process.env.BENCH_FORMAT === 'table') {
    const pad = (value, width) => String(value).padEnd(width)
    console.log(pad('case', 34), pad('wall ms (±)', 18), pad('cpu ms (±)', 18), 'extra')
    for (const r of results) {
      const extra = Object.entries(r)
        .filter(
          ([k]) =>
            ![
              'label',
              'runs',
              'wallMs',
              'wallSpreadMs',
              'cpuMs',
              'cpuSpreadMs',
              'heapDeltaBytes',
              'rssBytes',
            ].includes(k)
        )
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
      console.log(
        pad(r.label, 34),
        pad(`${r.wallMs} (±${r.wallSpreadMs})`, 18),
        pad(`${r.cpuMs} (±${r.cpuSpreadMs})`, 18),
        extra
      )
    }
    return
  }
  console.log(JSON.stringify({ node: process.version, results }, null, 2))
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
