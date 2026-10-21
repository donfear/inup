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
// Cloning and installing the fixture, and installing the tools, happen before
// any timing. Before timing, each tool runs once to prove it works on the
// fixture and found updates. The output is one JSON file per fixture, which
// scripts/bench-report.mjs turns into the README section, docs page and chart.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
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
]

/** Entries in a JSON report keyed by package (or by package.json, holding arrays). */
const countEntries = (json) =>
  Object.values(json).reduce((n, value) => n + (Array.isArray(value) ? value.length : 1), 0)

/**
 * The tools, each set up to report every dependency against its latest
 * version without writing anything. `fixture` is a described fixture:
 * `{ pm, workspaces }`. `count` reads the number of updates from stdout;
 * `failsWhenOutdated` marks the tools that exit 1 when they find updates.
 */
export const TOOLS = [
  {
    id: 'inup',
    name: () => 'inup',
    args: () => ['--json'],
    count: (stdout) => JSON.parse(stdout).summary.outdated,
  },
  {
    id: 'ncu',
    name: () => 'npm-check-updates',
    pkg: 'npm-check-updates',
    bin: 'ncu',
    args: (fixture) => ['--jsonUpgraded', ...(fixture.workspaces ? ['--workspaces'] : [])],
    // One object of upgrades, or one per package.json with --workspaces.
    count: (stdout) =>
      Object.values(JSON.parse(stdout)).reduce(
        (n, value) => n + (typeof value === 'object' ? Object.keys(value).length : 1),
        0
      ),
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
    count: (stdout) =>
      JSON.parse(stdout).packages.reduce(
        (n, pkg) => n + pkg.resolved.filter((dep) => dep.update).length,
        0
      ),
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
  },
  {
    id: 'pm',
    name: (fixture) => `${fixture.pm} outdated`,
    args: (fixture) =>
      fixture.pm === 'pnpm'
        ? ['outdated', ...(fixture.workspaces ? ['--recursive'] : []), '--format', 'json']
        : [
            'outdated',
            ...(fixture.workspaces ? ['--workspaces', '--include-workspace-root'] : []),
            '--json',
          ],
    failsWhenOutdated: true,
    count: (stdout) => countEntries(JSON.parse(stdout)),
  },
]

/** POSIX shell quoting. */
export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

/** The environment that points every cache a tool might use into `box`. */
export function sandboxEnv(box) {
  return {
    HOME: box,
    XDG_CONFIG_HOME: join(box, '.config'),
    XDG_CACHE_HOME: join(box, '.cache'),
    XDG_DATA_HOME: join(box, '.local', 'share'),
    XDG_STATE_HOME: join(box, '.local', 'state'),
    TMPDIR: join(box, 'tmp'),
  }
}

/** The shell command hyperfine times: `argv` run inside `box`. */
export function shellCommand(argv, box, { failsWhenOutdated = false } = {}) {
  const env = Object.entries(sandboxEnv(box)).map(([key, value]) => `${key}=${quote(value)}`)
  const command = [...env, ...argv.map(quote)].join(' ')
  // hyperfine stops at a non-zero exit; for these tools, 1 means "found updates".
  return failsWhenOutdated ? `${command} || [ $? -eq 1 ]` : command
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
  if (
    existsSync(join(dir, '.git')) &&
    run('git', ['rev-parse', 'HEAD'], { cwd: dir }) === fixture.sha
  )
    return
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  run('git', ['init', '-q'], { cwd: dir })
  run(
    'git',
    ['fetch', '-q', '--depth', '1', `https://github.com/${fixture.repo}.git`, fixture.sha],
    {
      cwd: dir,
    }
  )
  run('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: dir })
}

/** The fixture's package manager (from `packageManager`) and whether it is a monorepo. */
function inspectFixture(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const spec = pkg.packageManager?.split('+')[0]
  const [pm, version] = spec ? spec.split('@') : ['npm']
  if (pm !== 'npm' && pm !== 'pnpm') throw new Error(`unsupported package manager: ${pm}`)
  const workspaces = existsSync(join(dir, 'pnpm-workspace.yaml')) || pkg.workspaces !== undefined
  return { pm, pmVersion: version ?? null, workspaces }
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
 * pnpm as people run it. Since pnpm 11 the `pnpm` bin is a native executable
 * shipped in `@pnpm/exe.<platform>`; corepack starts it too. Older versions are
 * a Node.js script.
 */
function pnpmBin(prefix, version) {
  const scope = join(prefix, 'node_modules', '@pnpm')
  const exe = existsSync(scope)
    ? readdirSync(scope)
        .filter((name) => name.startsWith('exe.'))
        .map((name) => join(scope, name, 'pnpm'))
        .find((path) => existsSync(path))
    : undefined
  if (exe) return { argv: [exe], version }
  return nodeBin(prefix, 'pnpm', 'pnpm')
}

/** Where each tool's command comes from, and its version. */
function resolveTools(fixture, workdir) {
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
    pm:
      fixture.pm === 'pnpm'
        ? pnpmBin(
            npmInstall(join(workdir, `pnpm-${fixture.pmVersion}`), [`pnpm@${fixture.pmVersion}`]),
            fixture.pmVersion
          )
        : { argv: ['npm'], version: run('npm', ['--version']) },
  }
  for (const tool of TOOLS) {
    if (tool.pkg) bins[tool.id] = nodeBin(prefix, tool.pkg, tool.bin)
  }
  return bins
}

/** Run each tool once, untimed: it must succeed and report updates. */
function smokeTest(tool, argv, cwd, box) {
  rmSync(box, { recursive: true, force: true })
  mkdirSync(join(box, 'tmp'), { recursive: true })
  // Into a file, as hyperfine's /dev/null is: some tools exit before a pipe
  // drains, cutting their output off at 64 KB.
  const outFile = join(box, 'stdout')
  const out = openSync(outFile, 'w')
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...sandboxEnv(box) },
    stdio: ['ignore', out, 'pipe'],
  })
  closeSync(out)
  const stdout = readFileSync(outFile, 'utf8')
  const ok = result.status === 0 || (tool.failsWhenOutdated && result.status === 1)
  if (!ok || !stdout.trim()) {
    throw new Error(
      `${argv.join(' ')} exited with ${result.status ?? result.signal}\n${result.stderr.slice(-2000)}`
    )
  }
  const updates = tool.count(stdout)
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

  const dir = join(workdir, 'fixtures', fixture.id)
  log(`Checking out ${fixture.repo}@${fixture.sha.slice(0, 7)}`)
  checkout(fixture, dir)
  const described = { ...fixture, ...inspectFixture(dir) }

  log('Installing the tools')
  const bins = resolveTools(described, workdir)

  log(`Installing ${fixture.repo} with ${described.pm}`)
  const pm = bins.pm.argv
  if (described.pm === 'pnpm') {
    run(pm[0], [...pm.slice(1), 'install', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  } else {
    const install = existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install'
    run('npm', [install, '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }

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
    const updates = smokeTest(tool, argv, dir, join(workdir, 'boxes', 'smoke', tool.id))
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
