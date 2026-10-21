import { describe, expect, it } from 'vitest'
import {
  CHART_PATHS,
  describeChart,
  escapeXml,
  formatSeconds,
  joinNames,
  renderChart,
  renderDetails,
  renderReadme,
  renderTables,
  replaceBlock,
  sortResults,
} from '../../../scripts/bench-report.mjs'

const timing = (median: number) => ({
  median,
  mean: median,
  stddev: 0.012,
  min: median - 0.02,
  max: median + 0.03,
  times: [median],
})

const environment = {
  os: 'Linux 6.8.0-1017-azure',
  image: 'ubuntu24 20261012.1',
  cpu: 'AMD EPYC 7763 64-Core Processor',
  cores: 4,
  memoryGb: 16,
  node: 'v24.11.0',
  hyperfine: '1.20.0',
  run: 'https://github.com/donfear/inup/actions/runs/1',
}

const tool = (id: string, name: string, display: string, updates: number | null) => ({
  id,
  name,
  version: id === 'inup' ? '1.8.6 (dcb4f0c)' : '1.0.0',
  display,
  updates,
})

const express = {
  schema: 1,
  date: '2026-10-21T12:00:00.000Z',
  runs: 10,
  fixture: {
    id: 'express',
    repo: 'expressjs/express',
    sha: '0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8',
    packageManager: 'npm',
    workspaces: false,
    manifests: 1,
    dependencies: 44,
  },
  environment,
  tools: [
    tool('inup', 'inup', 'inup --json', 22),
    tool('ncu', 'npm-check-updates', 'ncu --jsonUpgraded', 21),
    tool('npm-check', 'npm-check', 'npm-check --skip-unused', null),
    tool('pm', 'npm outdated', 'npm outdated --json', 13),
  ],
  skipped: [],
  results: {
    cold: { inup: timing(0.389), ncu: timing(0.726), 'npm-check': timing(1.2), pm: timing(0.9) },
    warm: { inup: timing(0.38), ncu: timing(0.72), 'npm-check': timing(1.1), pm: timing(0.13) },
  },
}

const vue = {
  ...express,
  fixture: {
    id: 'vue-core',
    repo: 'vuejs/core',
    sha: '65eae178383289b6a9f93505ab85017460f72395',
    packageManager: 'pnpm@12.11.2',
    workspaces: true,
    manifests: 22,
    dependencies: 69,
  },
  tools: [
    tool('inup', 'inup', 'inup --json', 26),
    tool('ncu', 'npm-check-updates', 'ncu --jsonUpgraded --workspaces', 25),
    tool('pm', 'pnpm outdated', 'pnpm outdated --recursive --format json', 27),
  ],
  skipped: [{ id: 'npm-check', name: 'npm-check', reason: 'no workspace support' }],
  results: {
    cold: { inup: timing(1.68), ncu: timing(18.348), pm: timing(2.1) },
    warm: { inup: timing(0.9), ncu: timing(5.6), pm: timing(0.8) },
  },
}

const results = [express, vue]

describe('joinNames', () => {
  it('shares a common last word', () => {
    expect(joinNames(['npm outdated', 'pnpm outdated', 'bun outdated'])).toBe(
      'npm / pnpm / bun outdated'
    )
    expect(joinNames(['inup'])).toBe('inup')
    expect(joinNames(['npm outdated', 'yarn upgrade-interactive'])).toBe(
      'npm outdated / yarn upgrade-interactive'
    )
  })
})

describe('a repository where a tool did not run', () => {
  const yarn = {
    ...vue,
    fixture: { ...vue.fixture, id: 'backstage', repo: 'backstage/backstage' },
    tools: vue.tools.filter((t) => t.id !== 'pm'),
    skipped: [
      ...vue.skipped,
      {
        id: 'pm',
        name: 'yarn upgrade-interactive',
        reason: 'Yarn 2+ lists updates only in this interactive picker',
      },
    ],
    results: {
      cold: { inup: timing(6), ncu: timing(21) },
      warm: { inup: timing(1), ncu: timing(20) },
    },
  }

  it('keeps the row named for where it ran and shows a dash', () => {
    const [first] = renderTables([express, vue, yarn]).split('\n\n')
    expect(first).toContain('| npm / pnpm outdated | 0.90 s | 2.10 s | — |')
  })

  it('says why on the details page', () => {
    expect(renderDetails([yarn])).toContain(
      '| yarn upgrade-interactive | — | not run: Yarn 2+ lists updates only in this interactive picker | | |'
    )
  })
})

describe('formatSeconds', () => {
  it('keeps two decimals under ten seconds and one above', () => {
    expect(formatSeconds(0.389)).toBe('0.39 s')
    expect(formatSeconds(1.6849)).toBe('1.68 s')
    expect(formatSeconds(18.348)).toBe('18.3 s')
  })
})

describe('sortResults', () => {
  it('orders repositories as the fixtures are declared, smallest first', () => {
    const unknown = { ...express, fixture: { ...express.fixture, id: 'other' } }
    expect(sortResults([unknown, vue, express]).map((r: typeof express) => r.fixture.id)).toEqual([
      'express',
      'vue-core',
      'other',
    ])
  })
})

describe('renderTables', () => {
  const tables = renderTables(results)
  const [first, repeat] = tables.split('\n\n')

  it('heads each column with the pinned repository and its size', () => {
    expect(first).toContain(
      '[expressjs/express](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8)<br><sub>1 package.json · 44 dependencies</sub>'
    )
    expect(first).toContain('<sub>22 package.json files · 69 dependencies</sub>')
    expect(repeat.split('\n')[0]).toBe(
      '| Repeat run | [expressjs/express](https://github.com/expressjs/express/tree/0dee2c52c7c873498f8ed7d8ee4ddd0a04d3ada8) | [vuejs/core](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395) |'
    )
  })

  it('gives each tool a row, a dash where it did not run, and bolds the fastest', () => {
    expect(first).toContain('| inup | **0.39 s** | **1.68 s** |')
    expect(first).toContain('| npm-check-updates | 0.73 s | 18.3 s |')
    expect(first).toContain('| npm-check | 1.20 s | — |')
    expect(first).toContain('| npm / pnpm outdated | 0.90 s | 2.10 s |')
    expect(repeat).toContain('| inup | 0.38 s | 0.90 s |')
    expect(repeat).toContain('| npm / pnpm outdated | **0.13 s** | **0.80 s** |')
  })

  it('says how, where and when it was measured', () => {
    expect(tables).toContain('Median of 10 runs per tool')
    expect(tables).toContain('hyperfine](https://github.com/sharkdp/hyperfine) 1.20.0')
    expect(tables).toContain(
      'GitHub Actions ubuntu24 20261012.1, 4 CPUs, Node v24.11.0, 21 Oct 2026'
    )
    expect(tables).toContain("inup's times include its vulnerability check")
  })

  it('falls back to the OS name off GitHub Actions', () => {
    const local = { ...express, environment: { ...environment, image: null, cores: 1 } }
    expect(renderTables([local])).toContain('on Linux 6.8.0-1017-azure, 1 CPU,')
  })
})

describe('renderReadme', () => {
  const readme = renderReadme(results)

  it('opens with the heading and shows the chart for both themes', () => {
    expect(readme.startsWith('## Speed\n\n')).toBe(true)
    expect(readme).toContain(
      `<source media="(prefers-color-scheme: dark)" srcset="${CHART_PATHS.dark}">`
    )
    expect(readme).toContain(`src="${CHART_PATHS.light}"`)
  })

  it('describes the chart in its alt text', () => {
    expect(readme).toContain(
      'alt="First-run times in seconds. expressjs/express: inup 0.39 s, npm-check-updates 0.73 s, npm-check 1.20 s, npm outdated 0.90 s; vuejs/core: inup 1.68 s'
    )
  })

  it('links to the method', () => {
    expect(readme).toContain(
      "[How it's measured, tool versions and exact commands](docs/guide/benchmarks.md)"
    )
  })
})

describe('renderDetails', () => {
  const details = renderDetails(results)

  it('names each pinned repository with its package manager and size', () => {
    expect(details).toContain('### vuejs/core')
    expect(details).toContain(
      '[`vuejs/core@65eae17`](https://github.com/vuejs/core/tree/65eae178383289b6a9f93505ab85017460f72395) · pnpm@12.11.2 · 22 package.json files · 69 dependencies'
    )
  })

  it('lists version, spread and updates found for each tool, and why one did not run', () => {
    expect(details).toContain(
      '| inup | 1.8.6 (dcb4f0c) | **1.68 s** ± 0.01<br><sub>1.66–1.71</sub> | 0.90 s ± 0.01<br><sub>0.88–0.93</sub> | 26 |'
    )
    expect(details).toContain('| npm-check | 1.0.0 | 1.20 s ± 0.01<br><sub>1.18–1.23</sub> |')
    expect(details).toContain('| — |\n')
    expect(details).toContain('| npm-check | — | not run: no workspace support | | |')
  })

  it('shows the exact commands and the machine', () => {
    expect(details).toContain(
      '```sh\ninup --json\nncu --jsonUpgraded --workspaces\npnpm outdated --recursive --format json\n```'
    )
    expect(details).toContain(
      'Measured 21 Oct 2026 on GitHub Actions ubuntu24 20261012.1 · Linux 6.8.0-1017-azure · AMD EPYC 7763 64-Core Processor · 4 CPUs · 16 GB · Node v24.11.0 · hyperfine 1.20.0 · [workflow run](https://github.com/donfear/inup/actions/runs/1).'
    )
  })
})

describe('renderChart', () => {
  it('draws one panel per repository, fastest first, inup in the accent color', () => {
    const svg = renderChart(results, 'light')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg.match(/fill="#2a78d6"/g)).toHaveLength(2)
    const labels = [...svg.matchAll(/<text[^>]*dominant-baseline="central"[^>]*>([^<]+)<\/text>/g)]
      .map((match) => match[1])
      .filter((label) => !label.endsWith(' s'))
    expect(labels).toEqual([
      'inup',
      'npm-check-updates',
      'npm outdated',
      'npm-check',
      'inup',
      'pnpm outdated',
      'npm-check-updates',
    ])
  })

  it('scales each panel to its slowest tool', () => {
    const svg = renderChart(results, 'dark')
    const widths = [...svg.matchAll(/<path d="M150 [\d.]+h([\d.]+)/g)].map(
      (match) => Number(match[1]) + 4
    )
    // The slowest bar in each panel spans the whole bar area (720 - 150 - 64).
    expect(widths.filter((width) => Math.abs(width - 506) < 0.001)).toHaveLength(2)
    expect(svg).toContain('fill="#3987e5"')
  })

  it('escapes text', () => {
    const odd = { ...vue, fixture: { ...vue.fixture, repo: 'a&b/<c>' } }
    expect(renderChart([odd], 'light')).toContain('a&amp;b/&lt;c&gt;')
    expect(escapeXml('"x"')).toBe('&quot;x&quot;')
  })

  it('describes every bar', () => {
    expect(describeChart([vue])).toBe(
      'vuejs/core: inup 1.68 s, npm-check-updates 18.3 s, pnpm outdated 2.10 s'
    )
  })
})

describe('replaceBlock', () => {
  const page = 'intro\n<!-- BENCHMARK:START -->\nold\n<!-- BENCHMARK:END -->\noutro\n'

  it('replaces only what sits between the markers', () => {
    const updated = replaceBlock(page, 'BENCHMARK', 'new')
    expect(updated).toBe('intro\n<!-- BENCHMARK:START -->\nnew\n<!-- BENCHMARK:END -->\noutro\n')
    expect(replaceBlock(updated, 'BENCHMARK', 'new')).toBe(updated)
  })

  it('fails without both markers', () => {
    expect(() => replaceBlock('intro\n', 'BENCHMARK', 'new')).toThrow('<!-- BENCHMARK:START -->')
    expect(() =>
      replaceBlock('<!-- BENCHMARK:END -->\n<!-- BENCHMARK:START -->', 'BENCHMARK', 'new')
    ).toThrow()
  })
})
