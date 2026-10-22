#!/usr/bin/env node
// Turn scripts/bench-compare.mjs results into the README's speed section, the
// results on docs/guide/benchmarks.md and the chart beside them.
//
//   node scripts/bench-report.mjs bench-results/*.json
//
// Writes README.md and docs/guide/benchmarks.md between their BENCHMARK
// markers, docs/benchmark/speed-{light,dark}.svg, and bench-results/summary.md
// (the tables, for the workflow's job summary and pull request).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXTURES } from './bench-compare.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CHART_PATHS = {
  light: 'docs/benchmark/speed-light.svg',
  dark: 'docs/benchmark/speed-dark.svg',
}

/** Seconds, to two decimals under ten seconds and one above. */
export const formatSeconds = (seconds) => `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "22 package.json files · 69 dependencies" */
const sizes = ({ manifests, dependencies }) =>
  `${plural(manifests, 'package.json', 'package.json files')} · ${plural(dependencies, 'dependency', 'dependencies')}`

const repoUrl = ({ repo, sha }) => `https://github.com/${repo}/tree/${sha}`

/** Fixtures in their declared order, smallest first. */
export function sortResults(results) {
  const order = (result) => {
    const index = FIXTURES.findIndex((fixture) => fixture.id === result.fixture.id)
    return index === -1 ? FIXTURES.length : index
  }
  return [...results].sort((a, b) => order(a) - order(b))
}

/**
 * Names that share a command after the tool's name read as one:
 * "npm outdated", "pnpm outdated" as "npm / pnpm outdated".
 */
export function joinNames(names) {
  const groups = new Map()
  for (const name of names) {
    const space = name.indexOf(' ')
    const command = space === -1 ? '' : name.slice(space)
    groups.set(command, [
      ...(groups.get(command) ?? []),
      name.slice(0, name.length - command.length),
    ])
  }
  return [...groups].map(([command, tools]) => `${tools.join(' / ')}${command}`).join(' / ')
}

/**
 * What a table shows, as `{ tools, skipped, cold, warm }`: the tools listing
 * outdated dependencies, or their pickers.
 */
const LISTING = (result) => ({ tools: result.tools, skipped: result.skipped, ...result.results })
const PICKER = (result) => result.picker

/**
 * One row per tool across all fixtures, in the order the tools ran, named for
 * the fixtures it ran on (a skipped tool names its row only if it ran nowhere).
 */
function toolRows(views) {
  const rows = new Map()
  const add = (tool, kind) => {
    const row = rows.get(tool.id) ?? { id: tool.id, ran: new Set(), skipped: new Set() }
    row[kind].add(tool.name)
    rows.set(tool.id, row)
  }
  for (const view of views) {
    for (const tool of view.tools) add(tool, 'ran')
    for (const tool of view.skipped) add(tool, 'skipped')
  }
  return [...rows.values()].map((row) => ({
    id: row.id,
    name: joinNames([...(row.ran.size > 0 ? row.ran : row.skipped)]),
  }))
}

const fastest = (timings) => Math.min(...Object.values(timings).map((timing) => timing.median))

function table(results, view, mode, { title, withSizes }) {
  const header = results.map(({ fixture }) => {
    const link = `[${fixture.repo}](${repoUrl(fixture)})`
    return withSizes ? `${link}<br><sub>${sizes(fixture)}</sub>` : link
  })
  const lines = [
    `| ${title} | ${header.join(' | ')} |`,
    `| :-- | ${results.map(() => '--:').join(' | ')} |`,
  ]
  const views = results.map(view)
  for (const row of toolRows(views)) {
    const cells = views.map((timings) => {
      const timing = timings[mode][row.id]
      if (!timing) return '—'
      const text = formatSeconds(timing.median)
      return timing.median === fastest(timings[mode]) ? `**${text}**` : text
    })
    lines.push(`| ${row.name} | ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function where(environment) {
  const machine = environment.image ? `GitHub Actions ${environment.image}` : environment.os
  return `${machine}, ${plural(environment.cores, 'CPU', 'CPUs')}, Node ${environment.node}`
}

/**
 * The tables - listing outdated dependencies, then opening the picker, each
 * as a first run and a repeat run - and the line under them.
 */
export function renderTables(results) {
  const [first] = results
  const pickers = results.every((result) => result.picker)
  // Built with `pnpm build:all`: every run loads the addon, so nothing is downloaded.
  const native = results.every((result) => result.inupCore === 'native')
  const note = [
    'First run: every cache the tool keeps is emptied before each run. Repeat run: caches kept.',
    `Median of ${first.runs} runs per tool on ${where(first.environment)}, ${formatDate(first.date)}; listing timed with [hyperfine](https://github.com/sharkdp/hyperfine) ${first.environment.hyperfine}.`,
    pickers
      ? 'Pickers run in a 160×50 terminal and count as loaded at the last thing they draw or write to their cache before 5 s of quiet, so rows fetched off screen count too.'
      : null,
    "inup runs with `--no-audit`: the other tools don't check for vulnerabilities, so it skips its check too.",
    native
      ? 'inup runs on its native (Rust) core, built from the same commit.'
      : pickers
        ? "inup's first picker run also downloads its native core (about 1.5 MB)."
        : null,
    'Fastest in **bold**.',
  ]
    .filter(Boolean)
    .join(' ')
  return [
    '### Listing outdated dependencies',
    'Each tool prints every outdated dependency and exits.',
    table(results, LISTING, 'cold', { title: 'First run', withSizes: true }),
    table(results, LISTING, 'warm', { title: 'Repeat run', withSizes: false }),
    ...(pickers
      ? [
          '### Opening the picker',
          "Each tool's interactive list of updates, timed until every update is loaded.",
          table(results, PICKER, 'cold', { title: 'First run', withSizes: false }),
          table(results, PICKER, 'warm', { title: 'Repeat run', withSizes: false }),
        ]
      : []),
    `<sub>${note}</sub>`,
  ].join('\n\n')
}

/** Plain-text summary of the chart, for its alt text and SVG description. */
export function describeChart(results) {
  return results
    .map(({ fixture, tools, results: timings }) => {
      const parts = tools.map(
        (tool) => `${tool.name} ${formatSeconds(timings.cold[tool.id].median)}`
      )
      return `${fixture.repo}: ${parts.join(', ')}`
    })
    .join('; ')
}

/** The README section: heading, chart, tables. */
export function renderReadme(results) {
  return [
    '## Speed',
    'How long each tool takes, on public repositories pinned to a commit, to list every outdated dependency and to open its picker with every update loaded. Lower is better.',
    [
      '<picture>',
      `  <source media="(prefers-color-scheme: dark)" srcset="${CHART_PATHS.dark}">`,
      `  <img alt="${escapeXml(`First-run times in seconds. ${describeChart(results)}`)}" src="${CHART_PATHS.light}">`,
      '</picture>',
    ].join('\n'),
    renderTables(results),
    "[How it's measured, tool versions and exact commands](docs/guide/benchmarks.md)",
  ].join('\n\n')
}

function timingCell(timing, best) {
  if (!timing) return '—'
  const median = formatSeconds(timing.median)
  const spread = `± ${timing.stddev.toFixed(2)}<br><sub>${timing.min.toFixed(2)}–${timing.max.toFixed(2)}</sub>`
  return `${timing.median === best ? `**${median}**` : median} ${spread}`
}

/** One tool per row: version, first run, repeat run and any extra columns. */
function detailTable({ tools, skipped, cold, warm }, extra = []) {
  const bestCold = fastest(cold)
  const bestWarm = fastest(warm)
  const rows = tools.map((tool) =>
    [
      tool.name,
      tool.version,
      timingCell(cold[tool.id], bestCold),
      timingCell(warm[tool.id], bestWarm),
      ...extra.map(({ value }) => value(tool)),
    ].join(' | ')
  )
  for (const tool of skipped) {
    rows.push([tool.name, '—', `not run: ${tool.reason}`, '', ...extra.map(() => '')].join(' | '))
  }
  return [
    `| Tool | Version | First run | Repeat run |${extra.map(({ title }) => ` ${title} |`).join('')}`,
    `| :-- | :-- | --: | --: |${extra.map(() => ' --: |').join('')}`,
    ...rows.map((row) => `| ${row} |`),
  ].join('\n')
}

const commands = (tools) => ['```sh', ...tools.map((tool) => tool.display), '```'].join('\n')

/** The per-repository detail on docs/guide/benchmarks.md. */
export function renderDetails(results) {
  const sections = results.map((result) => {
    const { fixture, environment, tools } = result
    const facts = [
      `[\`${fixture.repo}@${fixture.sha.slice(0, 7)}\`](${repoUrl(fixture)})`,
      fixture.packageManager,
      sizes(fixture),
    ].join(' · ')
    const machine = [
      environment.image ? `GitHub Actions ${environment.image}` : null,
      environment.os,
      environment.cpu,
      plural(environment.cores, 'CPU', 'CPUs'),
      `${environment.memoryGb} GB`,
      `Node ${environment.node}`,
      `hyperfine ${environment.hyperfine}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const run = environment.run ? ` · [workflow run](${environment.run})` : ''
    const updates = { title: 'Updates found', value: (tool) => tool.updates ?? '—' }
    return [
      `### ${fixture.repo}`,
      facts,
      `Median, ± standard deviation, min–max, over ${result.runs} runs. Measured ${formatDate(result.date)} on ${machine}${run}.`,
      '#### Listing outdated dependencies',
      detailTable(LISTING(result), [updates]),
      'Commands, run in the repository root:',
      commands(tools),
      ...(result.picker
        ? [
            '#### Opening the picker',
            detailTable(result.picker),
            'Commands, run in the repository root in a 160×50 terminal:',
            commands(result.picker.tools),
          ]
        : []),
    ].join('\n\n')
  })
  return sections.join('\n\n')
}

const THEMES = {
  light: { ink: '#0b0b0b', muted: '#52514e', accent: '#2a78d6', other: '#898781' },
  dark: { ink: '#f0efec', muted: '#c3c2b7', accent: '#3987e5', other: '#898781' },
}

export function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** A bar from the baseline at `x`, square there, with a 4px rounded end. */
function barPath(x, y, width, height) {
  const r = Math.min(4, width / 2, height / 2)
  return `M${x} ${y}h${width - r}a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${r - width}z`
}

/**
 * First-run times as horizontal bars, one panel per repository, fastest at the
 * top. inup carries the accent color; every other tool shares one gray.
 * Each panel has its own scale: the repositories differ several-fold in size.
 */
export function renderChart(results, theme) {
  const color = THEMES[theme]
  const width = 720
  const labelWidth = 150
  const valueWidth = 64
  const barArea = width - labelWidth - valueWidth
  const rowHeight = 22
  const barHeight = 14
  const panelGap = 16
  const parts = []
  const text = (x, y, content, attrs = '') =>
    parts.push(`<text x="${x}" y="${y}"${attrs}>${escapeXml(content)}</text>`)

  text(
    0,
    14,
    'Listing outdated dependencies, first run (empty caches) · seconds, lower is better',
    ` fill="${color.muted}"`
  )
  let y = 36
  for (const { fixture, tools, results: timings } of results) {
    text(0, y + 14, fixture.repo, ` fill="${color.ink}" font-weight="600"`)
    text(0, y + 31, sizes(fixture), ` fill="${color.muted}"`)
    y += 40
    const rows = tools
      .map((tool) => ({ ...tool, median: timings.cold[tool.id].median }))
      .sort((a, b) => a.median - b.median)
    const max = rows.at(-1).median
    for (const row of rows) {
      const ours = row.id === 'inup'
      const weight = ours ? ' font-weight="600"' : ''
      const barWidth = Math.max(4, (row.median / max) * barArea)
      const middle = y + rowHeight / 2
      text(0, middle, row.name, ` fill="${color.ink}" dominant-baseline="central"${weight}`)
      parts.push(
        `<path d="${barPath(labelWidth, middle - barHeight / 2, barWidth, barHeight)}" fill="${ours ? color.accent : color.other}"/>`
      )
      text(
        labelWidth + barWidth + 6,
        middle,
        formatSeconds(row.median),
        ` fill="${color.ink}" dominant-baseline="central"${weight}`
      )
      y += rowHeight
    }
    y += panelGap
  }
  const height = y - panelGap
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    '<title id="title">How long each tool takes to list outdated dependencies</title>',
    `<desc id="desc">${escapeXml(`First-run times in seconds. ${describeChart(results)}`)}</desc>`,
    '<style>text{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px}</style>',
    ...parts,
    '</svg>',
    '',
  ].join('\n')
}

/** Replace what sits between `<!-- NAME:START -->` and `<!-- NAME:END -->`. */
export function replaceBlock(text, name, content) {
  const start = `<!-- ${name}:START -->`
  const end = `<!-- ${name}:END -->`
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (from === -1 || to < from) throw new Error(`markers ${start} … ${end} not found`)
  return `${text.slice(0, from + start.length)}\n${content}\n${text.slice(to)}`
}

function main(files) {
  if (files.length === 0) {
    console.error('Usage: node scripts/bench-report.mjs <results.json...>')
    process.exit(1)
  }
  const results = sortResults(files.map((file) => JSON.parse(readFileSync(file, 'utf8'))))
  const update = (path, name, content) => {
    const file = join(ROOT, path)
    writeFileSync(file, replaceBlock(readFileSync(file, 'utf8'), name, content))
  }
  update('README.md', 'BENCHMARK', renderReadme(results))
  update('docs/guide/benchmarks.md', 'BENCHMARK', renderDetails(results))
  for (const [theme, path] of Object.entries(CHART_PATHS)) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true })
    writeFileSync(join(ROOT, path), renderChart(results, theme))
  }
  const summary = join(dirname(resolve(files[0])), 'summary.md')
  writeFileSync(summary, `${renderTables(results)}\n`)
  console.log(`Updated README.md, docs/guide/benchmarks.md and the charts; tables in ${summary}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
