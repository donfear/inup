// Run from the repository root: node --expose-gc test/benchmarks/performance.cjs
// Synthetic, offline fixtures. No user config/cache writes or real installs.
const fs = require('node:fs')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')

require.extensions['.ts'] = (mod, file) => {
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file
  )
}
process.env.INUP_NET_PROFILE = '0'
process.env.INUP_PERF = '0'
require('chalk').default.level = 0
require('../../src/shared/http/etag-store.ts').setEtagCacheEnabled(false)
require('../../src/shared/registry/registry-config.ts').registryTargetFor = () => ({
  origin: 'https://benchmark.invalid',
  pathPrefix: '',
})
const { ConsoleUtils } = require('../../src/shared/terminal/index.ts')
ConsoleUtils.showProgress = () => {}
ConsoleUtils.clearProgress = () => {}
let dependencies = []
let responseDelay = () => 0
const versions = Object.fromEntries([
  ['2.0.0', {}],
  ...Array.from({ length: 50 }, (_, i) => [`1.${i}.0`, {}]),
])
const body = Buffer.from(JSON.stringify({ versions }))
require('undici').Pool = class {
  async request({ path }) {
    const delay = responseDelay(path)
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    return { statusCode: 200, headers: {}, body: { arrayBuffer: async () => body } }
  }
}
require('../../src/shared/fs/scan.ts').findAllPackageJsonFilesAsync = async () => [
  `${process.cwd()}/package.json`,
]
require('../../src/shared/fs/io.ts').collectAllDependenciesAsync = async () => dependencies
const { PackageDetector } = require('../../src/features/upgrade/package-detector.ts')
const list = require('../../src/features/interactive/renderer/package-list/index.ts')
const { makeSelectionState } = require('../fixtures/selection-state-factory.ts')
const { getPerformanceTracker } = require('../../src/features/debug/index.ts')
const results = []
async function measure(label, run) {
  global.gc?.()
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  const start = performance.now()
  const details = await run()
  const usedCpu = process.cpuUsage(cpu)
  const after = process.memoryUsage()
  results.push({
    label,
    wallMs: +(performance.now() - start).toFixed(2),
    cpuMs: +((usedCpu.user + usedCpu.system) / 1000).toFixed(2),
    heapDeltaBytes: after.heapUsed - memory.heapUsed,
    rssBytes: after.rss,
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
    const cache = list.VersionColumnWidthCache ? new list.VersionColumnWidthCache() : null
    let revision = 0
    const frame = () => {
      const options = cache ? { columnWidths: cache.get(states, 120, revision, '') } : {}
      return list.renderInterface(
        states,
        0,
        0,
        20,
        false,
        undefined,
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
        if (cache) revision++
        frame()
      })
    )
  }
  console.log(JSON.stringify({ node: process.version, results }, null, 2))
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
