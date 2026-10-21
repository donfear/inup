#!/usr/bin/env node
// Time inup against the tools people use for the same job, on public
// repositories pinned to a commit. hyperfine does the timing.
//
//   node scripts/bench-compare.mjs --fixture vue-core [--runs 10] [--out <file>] [--workdir <dir>]
//   pnpm bench:compare --fixture express            (builds inup first)
//
// Every tool is asked the same question - which dependencies in every
// package.json are behind their latest version - and runs headless from launch
// to exit, its output discarded. Two modes:
//
//   cold  each run starts with the tool's caches empty: hyperfine's --prepare
//         gives it a fresh HOME, XDG directories and TMPDIR
//   warm  the tool keeps its caches; an untimed warmup run fills them
//
// Then each tool's interactive picker, where it has one, runs in a terminal
// (scripts/bench-pty.py, so python3 is needed) and is timed until it has every
// update loaded: the last thing it draws or writes to its cache before going
// quiet. The same two modes apply.
//
// Cloning and installing the fixture, and installing the tools, happen before
// any timing. Before timing, each tool runs once to prove it works on the
// fixture and found updates. The output is one JSON file per fixture, which
// scripts/bench-report.mjs turns into the README section, docs page and chart.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs'
import { cpus, release, tmpdir, totalmem, type } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Public repositories, pinned so every run measures the same manifests. */
export const FIXTURES = [
  { id: 'express', repo: 'expressjs/express', sha: '0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8' },
  { id: 'vue-core', repo: 'vuejs/core', sha: '65eae178383289b6a9f93505ab85017460f72395' },
  {
    id: 'tanstack-query',
    repo: 'TanStack/query',
    sha: 'ce77be5e15c695df9d4d9122caf9256d334433ba',
  },
  { id: 'vendure', repo: 'vendurehq/vendure', sha: '1dcaf0ee504675f3462d6302c23ff9f16beb2773' },
  {
    id: 'backstage',
    repo: 'backstage/backstage',
    sha: '76b0c7a48ef737b1a46342c29269827715d70684',
  },
]

/** Entries in a JSON report keyed by package (or by package.json, holding arrays). */
const countEntries = (json) =>
  Object.values(json).reduce((n, value) => n + (Array.isArray(value) ? value.length : 1), 0)

/** Rows of a `| Package | Current | ... |` table, header excluded. */
const tableRows = (text) =>
  Math.max(0, text.split('\n').filter((line) => /^\| \S/.test(line)).length - 1)

/**
 * The tools, each set up to report every dependency against its latest
 * version without writing anything. `fixture` is a described fixture:
 * `{ pm, workspaces }`. `count` reads the number of updates from the output,
 * `{ stdout, stderr }`; `failsWhenOutdated` marks the tools that exit 1 when
 * they find updates. `picker` opens the tool's interactive list of updates
 * instead, where it has one that shows every update at once.
 */
export const TOOLS = [
  {
    id: 'inup',
    name: () => 'inup',
    args: () => ['--json'],
    count: ({ stdout }) => JSON.parse(stdout).summary.outdated,
    picker: { args: () => [] },
  },
  {
    id: 'ncu',
    name: () => 'npm-check-updates',
    pkg: 'npm-check-updates',
    bin: 'ncu',
    args: (fixture) => ['--jsonUpgraded', ...(fixture.workspaces ? ['--workspaces'] : [])],
    // One object of upgrades, or one per package.json with --workspaces.
    count: ({ stdout }) =>
      Object.values(JSON.parse(stdout)).reduce(
        (n, value) => n + (typeof value === 'object' ? Object.keys(value).length : 1),
        0
      ),
    picker: {
      args: () => ['--interactive'],
      // With --workspaces it lists one package.json, and fetches the next after you answer.
      unsupported: (fixture) =>
        fixture.workspaces ? 'asks about one package.json at a time' : null,
    },
  },
  {
    id: 'taze',
    name: () => 'taze',
    pkg: 'taze',
    bin: 'taze',
    // `major` reports every update, majors included, as the others do;
    // --include-locked adds pinned versions. GitHub Actions and Node version
    // files are not npm dependencies, and checking them calls GitHub's API.
    args: (fixture) => [
      'major',
      ...(fixture.workspaces ? ['--recursive'] : []),
      '--include-locked',
      '--no-github-actions',
      '--no-node-version',
      '--json',
    ],
    count: ({ stdout }) =>
      JSON.parse(stdout).packages.reduce(
        (n, pkg) => n + pkg.resolved.filter((dep) => dep.update).length,
        0
      ),
    picker: {
      args: (fixture) => [
        'major',
        '--interactive',
        ...(fixture.workspaces ? ['--recursive'] : []),
        '--include-locked',
        '--no-github-actions',
        '--no-node-version',
      ],
    },
  },
  {
    id: 'syncpack',
    name: () => 'syncpack',
    pkg: 'syncpack',
    bin: 'syncpack',
    // --check lists updates without writing; it reports on stderr, one line
    // per dependency and version: "  1x react ^18.3.1 (~1.9y) → ^19.2.0 (~3mo)".
    args: () => ['update', '--check'],
    failsWhenOutdated: true,
    count: ({ stderr }) =>
      stderr.split('\n').filter((line) => /^\s+\d+x \S.* → /.test(line)).length,
    picker: { args: () => ['update', '--interactive'] },
  },
  {
    id: 'npm-check',
    name: () => 'npm-check',
    pkg: 'npm-check',
    bin: 'npm-check',
    // Finding unused dependencies is a different job.
    args: () => ['--skip-unused'],
    failsWhenOutdated: true,
    unsupported: (fixture) => (fixture.workspaces ? 'no workspace support' : null),
    count: () => null, // prints a table only
    picker: {
      args: () => ['--update', '--skip-unused'],
      unsupported: (fixture) => (fixture.workspaces ? 'no workspace support' : null),
    },
  },
  {
    id: 'pm',
    name: (fixture) =>
      fixture.pm === 'yarn' ? 'yarn upgrade-interactive' : `${fixture.pm} outdated`,
    args: (fixture) => {
      const workspaces = fixture.workspaces
      if (fixture.pm === 'pnpm') {
        return ['outdated', ...(workspaces ? ['--recursive'] : []), '--format', 'json']
      }
      if (fixture.pm === 'bun') return ['outdated', ...(workspaces ? ['--recursive'] : [])]
      return [
        'outdated',
        ...(workspaces ? ['--workspaces', '--include-workspace-root'] : []),
        '--json',
      ]
    },
    // npm and pnpm exit 1 when they find updates; bun exits 0.
    failsWhenOutdated: true,
    unsupported: (fixture) =>
      fixture.pm === 'yarn' ? 'Yarn 2+ lists updates only in this interactive picker' : null,
    count: ({ stdout }, fixture) =>
      fixture.pm === 'bun' ? tableRows(stdout) : countEntries(JSON.parse(stdout)),
    picker: {
      name: (fixture) =>
        fixture.pm === 'yarn' ? 'yarn upgrade-interactive' : `${fixture.pm} update -i`,
      args: (fixture) => {
        const recursive = fixture.workspaces ? ['--recursive'] : []
        if (fixture.pm === 'yarn') return ['upgrade-interactive']
        if (fixture.pm === 'pnpm') return ['update', '--interactive', '--latest', ...recursive]
        return ['update', '--interactive', ...recursive]
      },
      unsupported: (fixture) => (fixture.pm === 'npm' ? 'npm has no interactive update' : null),
    },
  },
]

/** POSIX shell quoting. */
export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

/**
 * The environment that points every cache a tool might use into `box`. Most
 * follow HOME, XDG and TMPDIR; the rest have variables of their own that a
 * developer's shell may set (BUN_INSTALL, for one).
 */
export function sandboxEnv(box) {
  return {
    HOME: box,
    XDG_CONFIG_HOME: join(box, '.config'),
    XDG_CACHE_HOME: join(box, '.cache'),
    XDG_DATA_HOME: join(box, '.local', 'share'),
    XDG_STATE_HOME: join(box, '.local', 'state'),
    TMPDIR: join(box, 'tmp'),
    npm_config_cache: join(box, '.npm'),
    BUN_INSTALL: join(box, '.bun'),
    BUN_INSTALL_CACHE_DIR: join(box, '.bun', 'install', 'cache'),
    YARN_GLOBAL_FOLDER: join(box, '.yarn', 'berry'),
  }
}

/** The shell command hyperfine times: `argv` run inside `box`. */
export function shellCommand(argv, box, { failsWhenOutdated = false } = {}) {
  const env = Object.entries(sandboxEnv(box)).map(([key, value]) => `${key}=${quote(value)}`)
  const command = [...env, ...argv.map(quote)].join(' ')
  // hyperfine stops at a non-zero exit; for these tools, 1 means "found updates".
  return failsWhenOutdated ? `${command} || [ $? -eq 1 ]` : command
}

const PTY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'bench-pty.py')
/** How long a picker must stay quiet to count as loaded. */
const PICKER_IDLE_MS = 5000
const PICKER_LIMIT_MS = 180_000
/** Pickers refuse to open in CI; these are the variables they look at. */
const CI_VARIABLES = ['CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'BUILD_NUMBER', 'RUN_ID']

/** A picker's environment: the sandbox, a color terminal, and no sign of CI. */
export function pickerEnv(box, env = process.env) {
  const result = { ...env, ...sandboxEnv(box), TERM: 'xterm-256color' }
  for (const key of CI_VARIABLES) delete result[key]
  return result
}

/**
 * Time a picker, in seconds: launch `argv` in a terminal (scripts/bench-pty.py)
 * and wait until it goes quiet, with nothing drawn and nothing written under
 * `box` for `idleMs`. The time is the last thing it drew or wrote: a picker
 * may finish drawing the rows on screen and keep fetching the rest, writing
 * each into its cache. One that exits first never opened; one that is still
 * busy after `limitMs` fails too.
 */
export function timePicker(argv, { cwd, box, idleMs = PICKER_IDLE_MS, limitMs = PICKER_LIMIT_MS }) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let lastDrawn = 0
    let lastEvent = 0
    let lastWritten = 0
    let drawn = 0
    let stderr = ''
    let exit = null
    const watcher = watch(box, { recursive: true }, (_event, file) => {
      lastEvent = Date.now()
      let written = lastEvent
      try {
        if (file) written = statSync(join(box, file)).mtimeMs
      } catch {
        // renamed or removed already
      }
      lastWritten = Math.max(lastWritten, written)
    })
    const child = spawn('python3', ['-I', PTY_SCRIPT, ...argv], {
      cwd,
      env: pickerEnv(box),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (data) => {
      drawn += data.length
      lastDrawn = Date.now()
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.on('exit', (code, signal) => {
      exit ??= code ?? signal
    })
    child.on('error', (error) => {
      exit ??= error.message
    })
    // Settle once the picker is gone, so the next run starts on a quiet machine.
    let outcome
    let closed = false
    const settle = () => {
      if (outcome === undefined || !closed) return
      outcome instanceof Error ? reject(outcome) : resolve(outcome)
    }
    child.on('close', () => {
      closed = true
      settle()
    })
    const poll = setInterval(() => {
      const now = Date.now()
      const quiet = now - Math.max(start, lastDrawn, lastEvent)
      if (exit === null && quiet < idleMs && now - start < limitMs) return
      clearInterval(poll)
      watcher.close()
      const command = argv.join(' ')
      if (exit !== null) {
        outcome = new Error(
          `${command} exited (${exit}) instead of waiting\n${stderr.slice(-2000)}`
        )
      } else if (quiet < idleMs) {
        outcome = new Error(`${command} was still busy after ${limitMs / 1000} s`)
      } else if (drawn === 0) {
        outcome = new Error(`${command} drew nothing`)
      } else {
        outcome = (Math.max(lastDrawn, lastWritten) - start) / 1000
      }
      child.kill('SIGTERM')
      settle()
    }, 50)
  })
}

/** Median, mean, sample standard deviation and range, as hyperfine reports them. */
export function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b)
  const middle = sorted.length / 2
  const median = Number.isInteger(middle)
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[Math.floor(middle)]
  const mean = times.reduce((sum, time) => sum + time, 0) / times.length
  const variance =
    times.length > 1
      ? times.reduce((sum, time) => sum + (time - mean) ** 2, 0) / (times.length - 1)
      : 0
  return {
    median,
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted.at(-1),
    times,
  }
}

/** Empty `box` and recreate it, ready for a run. */
export const resetBoxCommand = (box) =>
  `rm -rf ${quote(box)} && mkdir -p ${quote(join(box, 'tmp'))}`

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const LOCAL_SPEC = /^(workspace|file|link|portal):/

/** package.json files under `dir` and the registry dependencies they name. */
export function countManifests(dir) {
  let manifests = 0
  const dependencies = new Set()
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.'))
          walk(join(path, entry.name))
      } else if (entry.name === 'package.json') {
        manifests++
        const pkg = JSON.parse(readFileSync(join(path, entry.name), 'utf8'))
        for (const field of DEPENDENCY_FIELDS) {
          for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
            if (!LOCAL_SPEC.test(spec)) dependencies.add(name)
          }
        }
      }
    }
  }
  walk(dir)
  return { manifests, dependencies: dependencies.size }
}

const run = (command, args, options = {}) =>
  (
    execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      ...options,
    }) ?? ''
  ).trim()

const log = (message) => console.error(`\n> ${message}`)

function checkout(fixture, dir) {
  const git = (...args) => run('git', args, { cwd: dir })
  if (existsSync(join(dir, '.git')) && git('rev-parse', 'HEAD') === fixture.sha) return
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  git('init', '-q')
  git('fetch', '-q', '--depth', '1', `https://github.com/${fixture.repo}.git`, fixture.sha)
  git('checkout', '-q', 'FETCH_HEAD')
}

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

/**
 * The fixture's package manager - from `packageManager`, else its lockfile -
 * and whether it is a monorepo.
 */
export function inspectFixture(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const spec = pkg.packageManager?.split('+')[0]
  const fromLockfile = LOCKFILES.find(([file]) => existsSync(join(dir, file)))?.[1] ?? 'npm'
  const [pm, version] = spec ? spec.split('@') : [fromLockfile]
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) {
    throw new Error(`unsupported package manager: ${pm}`)
  }
  if (pm === 'yarn' && !(Number(version?.split('.')[0]) >= 2)) {
    throw new Error('only Yarn 2+ projects with a packageManager version are supported')
  }
  const workspaces = existsSync(join(dir, 'pnpm-workspace.yaml')) || pkg.workspaces !== undefined
  return { pm, pmVersion: version ?? null, workspaces }
}

/** Arguments that install a fixture's dependencies without running its scripts. */
const INSTALL = {
  npm: (dir) => [
    existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ],
  pnpm: () => ['install', '--frozen-lockfile', '--ignore-scripts'],
  bun: () => ['install', '--frozen-lockfile', '--ignore-scripts'],
  yarn: () => ['install', '--immutable', '--mode=skip-build'],
}

/** Install npm packages into `dir`; returns the directory holding node_modules. */
function npmInstall(dir, specs) {
  mkdirSync(dir, { recursive: true })
  run(
    'npm',
    ['install', '--prefix', dir, '--no-audit', '--no-fund', '--ignore-scripts', ...specs],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  )
  return dir
}

const readPackage = (prefix, name) =>
  JSON.parse(readFileSync(join(prefix, 'node_modules', name, 'package.json'), 'utf8'))

/** `[node, <bin script>]` for an npm package installed under `prefix`. */
function nodeBin(prefix, name, bin) {
  const pkg = readPackage(prefix, name)
  const path = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[bin]
  return {
    argv: [process.execPath, join(prefix, 'node_modules', name, path)],
    version: pkg.version,
  }
}

/**
 * The native executable an npm package ships in a per-platform optional
 * dependency (`@pnpm/exe.linux-x64/pnpm`, `@oven/bun-linux-x64/bin/bun`): what
 * its bin runs once installed. npm installs only the host's platform package.
 */
function platformBinary(prefix, scope, packagePrefix, file) {
  const dir = join(prefix, 'node_modules', scope)
  if (!existsSync(dir)) return undefined
  return readdirSync(dir)
    .filter((name) => name.startsWith(packagePrefix))
    .map((name) => join(dir, name, file))
    .find((path) => existsSync(path))
}

/** The package manager, run as its own users run it. */
function packageManagerBin(fixture, dir, workdir) {
  const { pm, pmVersion } = fixture
  if (pm === 'npm') return { argv: ['npm'], version: run('npm', ['--version']) }
  if (pm === 'yarn') {
    // Yarn projects usually commit their Yarn release and point yarnPath at it.
    const rc = join(dir, '.yarnrc.yml')
    const yarnPath =
      existsSync(rc) && /^yarnPath:\s*['"]?([^'"\s]+)/m.exec(readFileSync(rc, 'utf8'))?.[1]
    if (yarnPath) return { argv: [process.execPath, join(dir, yarnPath)], version: pmVersion }
    const prefix = npmInstall(join(workdir, `yarn-${pmVersion}`), [
      `@yarnpkg/cli-dist@${pmVersion}`,
    ])
    return nodeBin(prefix, '@yarnpkg/cli-dist', 'yarn')
  }
  const spec = `${pm}@${pmVersion ?? 'latest'}`
  const prefix = npmInstall(join(workdir, spec), [spec])
  const version = readPackage(prefix, pm).version
  // Since pnpm 11, and for bun, the bin is a native executable.
  const exe =
    pm === 'pnpm'
      ? platformBinary(prefix, '@pnpm', 'exe.', 'pnpm')
      : platformBinary(prefix, '@oven', 'bun-', join('bin', 'bun'))
  return exe ? { argv: [exe], version } : nodeBin(prefix, pm, pm)
}

/** Where each tool's command comes from, and its version. */
function resolveTools(fixture, dir, workdir) {
  const prefix = npmInstall(
    join(workdir, 'tools'),
    TOOLS.filter((tool) => tool.pkg).map((tool) => `${tool.pkg}@latest`)
  )
  const inupVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const commit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
  const bins = {
    inup: {
      argv: [process.execPath, join(ROOT, 'dist', 'cli.js')],
      version: `${inupVersion} (${commit})`,
    },
    pm: packageManagerBin(fixture, dir, workdir),
  }
  for (const tool of TOOLS) {
    if (tool.pkg) bins[tool.id] = nodeBin(prefix, tool.pkg, tool.bin)
  }
  return bins
}

/** Run each tool once, untimed: it must succeed and report updates. */
function smokeTest(tool, fixture, argv, cwd, box) {
  rmSync(box, { recursive: true, force: true })
  mkdirSync(join(box, 'tmp'), { recursive: true })
  // Into files, as hyperfine's /dev/null is: some tools exit before a pipe
  // drains, cutting their output off at 64 KB.
  const outFile = join(box, 'stdout')
  const errFile = join(box, 'stderr')
  const out = openSync(outFile, 'w')
  const err = openSync(errFile, 'w')
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: { ...process.env, ...sandboxEnv(box) },
    stdio: ['ignore', out, err],
  })
  closeSync(out)
  closeSync(err)
  const output = { stdout: readFileSync(outFile, 'utf8'), stderr: readFileSync(errFile, 'utf8') }
  const ok = result.status === 0 || (tool.failsWhenOutdated && result.status === 1)
  if (!ok || !`${output.stdout}${output.stderr}`.trim()) {
    throw new Error(
      `${argv.join(' ')} exited with ${result.status ?? result.signal}\n${output.stderr.slice(-2000)}`
    )
  }
  const updates = tool.count(output, fixture)
  if (updates === 0) throw new Error(`${argv.join(' ')} reported no updates; it checked nothing`)
  return updates
}

/** Time every tool in one hyperfine invocation; returns hyperfine's results in order. */
function hyperfine({ tools, cwd, runs, mode, out }) {
  const args = ['--runs', String(runs), '--warmup', '1', '--style', 'basic', '--export-json', out]
  for (const tool of tools) {
    if (mode === 'cold') args.push('--prepare', resetBoxCommand(tool.box))
    args.push('--command-name', tool.name)
  }
  args.push(...tools.map((tool) => tool.command))
  execFileSync('hyperfine', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
  return JSON.parse(readFileSync(out, 'utf8')).results
}

const stats = ({ median, mean, stddev, min, max, times }) => ({
  median,
  mean,
  stddev,
  min,
  max,
  times,
})

function environment() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, ImageOS, ImageVersion } = process.env
  return {
    os: `${type()} ${release()}`,
    image: ImageOS ? `${ImageOS} ${ImageVersion}` : null,
    cpu: cpus()[0]?.model.trim() ?? null,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    hyperfine: run('hyperfine', ['--version']).replace(/^hyperfine /, ''),
    run: GITHUB_RUN_ID
      ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
      : null,
  }
}

/**
 * Keep what installing left behind out of `git status`: inup's picker asks
 * before it works on a tree with uncommitted changes.
 */
function hideFromGit(dir) {
  const git = (...args) => run('git', args, { cwd: dir })
  for (const entry of git('status', '--porcelain', '-z').split('\0').filter(Boolean)) {
    const path = entry.slice(3)
    if (entry.startsWith('??')) appendFileSync(join(dir, '.git', 'info', 'exclude'), `/${path}\n`)
    else git('update-index', '--assume-unchanged', path)
  }
  if (git('status', '--porcelain')) throw new Error(`could not clean the git status of ${dir}`)
}

/**
 * Time each picker `runs` times, in rounds: every tool once per round, so a
 * slow spell on the network lands on all of them alike. An untimed first run
 * proves each one opens and, for warm runs, fills its caches.
 */
async function timePickers(tools, { cwd, runs, mode, workdir }) {
  const boxes = tools.map((tool) => join(workdir, 'boxes', `picker-${mode}`, tool.id))
  const reset = (box) => {
    rmSync(box, { recursive: true, force: true })
    mkdirSync(join(box, 'tmp'), { recursive: true })
  }
  const time = async (i) => {
    if (mode === 'cold') reset(boxes[i])
    const seconds = await timePicker(tools[i].argv, { cwd, box: boxes[i] })
    console.error(`  ${tools[i].name}: ${seconds.toFixed(2)} s`)
    return seconds
  }
  boxes.forEach(reset)
  for (const i of tools.keys()) await time(i)
  const times = tools.map(() => [])
  for (let round = 0; round < runs; round++) {
    for (const i of tools.keys()) times[i].push(await time(i))
  }
  return Object.fromEntries(tools.map((tool, i) => [tool.id, summarize(times[i])]))
}

export async function benchmark({ fixtureId, runs, out, workdir }) {
  const fixture = FIXTURES.find((candidate) => candidate.id === fixtureId)
  if (!fixture) {
    const ids = FIXTURES.map((candidate) => candidate.id).join(', ')
    throw new Error(`unknown fixture "${fixtureId}"; one of: ${ids}`)
  }
  if (spawnSync('hyperfine', ['--version']).error) {
    throw new Error('hyperfine not found: https://github.com/sharkdp/hyperfine#installation')
  }
  if (!existsSync(join(ROOT, 'dist', 'cli.js'))) {
    throw new Error('dist/cli.js not found; run pnpm build')
  }
  if (spawnSync('python3', ['--version']).error) {
    throw new Error('python3 not found; the picker timings run in a terminal it provides')
  }

  const dir = join(workdir, 'fixtures', fixture.id)
  log(`Checking out ${fixture.repo}@${fixture.sha.slice(0, 7)}`)
  checkout(fixture, dir)
  const described = { ...fixture, ...inspectFixture(dir) }

  log('Installing the tools')
  const bins = resolveTools(described, dir, workdir)

  log(`Installing ${fixture.repo} with ${described.pm}`)
  const [command, ...pmArgs] = bins.pm.argv
  run(command, [...pmArgs, ...INSTALL[described.pm](dir)], {
    cwd: dir,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  hideFromGit(dir)

  const tools = []
  const skipped = []
  for (const tool of TOOLS) {
    const name = tool.name(described)
    const reason = tool.unsupported?.(described)
    if (reason) {
      skipped.push({ id: tool.id, name, reason })
      continue
    }
    const args = tool.args(described)
    const argv = [...bins[tool.id].argv, ...args]
    log(`Checking ${name} works on ${fixture.repo}`)
    const updates = smokeTest(tool, described, argv, dir, join(workdir, 'boxes', 'smoke', tool.id))
    tools.push({
      id: tool.id,
      name,
      version: bins[tool.id].version,
      display: [tool.bin ?? name.split(' ')[0], ...args].join(' '),
      updates,
      argv,
      failsWhenOutdated: tool.failsWhenOutdated,
    })
  }

  const results = {}
  for (const mode of ['cold', 'warm']) {
    log(`Timing ${mode} runs (${runs} per tool)`)
    const timed = tools.map((tool) => {
      const box = join(workdir, 'boxes', mode, tool.id)
      rmSync(box, { recursive: true, force: true })
      mkdirSync(join(box, 'tmp'), { recursive: true })
      return { ...tool, box, command: shellCommand(tool.argv, box, tool) }
    })
    const raw = join(workdir, `hyperfine-${fixture.id}-${mode}.json`)
    const measured = hyperfine({ tools: timed, cwd: dir, runs, mode, out: raw })
    results[mode] = Object.fromEntries(timed.map((tool, i) => [tool.id, stats(measured[i])]))
  }

  const pickers = []
  const pickersSkipped = []
  for (const tool of TOOLS) {
    const name = tool.picker.name?.(described) ?? tool.name(described)
    const reason = tool.picker.unsupported?.(described)
    if (reason) {
      pickersSkipped.push({ id: tool.id, name, reason })
      continue
    }
    const args = tool.picker.args(described)
    pickers.push({
      id: tool.id,
      name,
      version: bins[tool.id].version,
      display: [tool.bin ?? name.split(' ')[0], ...args].join(' '),
      argv: [...bins[tool.id].argv, ...args],
    })
  }
  const picker = { tools: pickers.map(({ argv, ...tool }) => tool), skipped: pickersSkipped }
  for (const mode of ['cold', 'warm']) {
    log(`Timing ${mode} picker runs (${runs} per tool)`)
    picker[mode] = await timePickers(pickers, { cwd: dir, runs, mode, workdir })
  }

  const report = {
    schema: 1,
    date: new Date().toISOString(),
    runs,
    fixture: {
      id: fixture.id,
      repo: fixture.repo,
      sha: fixture.sha,
      packageManager: described.pmVersion ? `${described.pm}@${described.pmVersion}` : described.pm,
      workspaces: described.workspaces,
      ...countManifests(dir),
    },
    environment: environment(),
    tools: tools.map(({ id, name, version, display, updates }) => ({
      id,
      name,
      version,
      display,
      updates,
    })),
    skipped,
    results,
    picker,
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  log(`Wrote ${out}`)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string' },
      runs: { type: 'string', default: '10' },
      out: { type: 'string' },
      workdir: { type: 'string', default: join(tmpdir(), 'inup-bench') },
    },
  })
  const runs = Number(values.runs)
  if (!values.fixture || !Number.isInteger(runs) || runs < 2) {
    console.error(
      `Usage: node scripts/bench-compare.mjs --fixture <${FIXTURES.map((f) => f.id).join('|')}> [--runs <n ≥ 2>] [--out <file>] [--workdir <dir>]`
    )
    process.exit(1)
  }
  benchmark({
    fixtureId: values.fixture,
    runs,
    out: resolve(values.out ?? join('bench-results', `${values.fixture}.json`)),
    workdir: resolve(values.workdir),
  }).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
