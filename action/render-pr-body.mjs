#!/usr/bin/env node
// @ts-check
/**
 * Render a human-readable PR body from an `inup --json` report.
 *
 * Reads the JSON document on argv[2] (a file path) or stdin, and writes GitHub-flavored markdown to
 * stdout. The body is the product's differentiator: it makes the vulnerability-fix verdict
 * (does the in-range bump already clear the CVE, or only the major?) and the skipped majors visible.
 *
 * Pure Node, no dependencies — runs in the Action via `node`.
 */

import { readFileSync } from 'node:fs'

/** @typedef {import('../src/features/headless/types').HeadlessReport} HeadlessReport */

function readInput() {
  const path = process.argv[2]
  const raw = path && path !== '-' ? readFileSync(path, 'utf-8') : readFileSync(0, 'utf-8')
  return JSON.parse(raw)
}

/** A short verdict on whether upgrading clears every advisory on this package. */
function vulnVerdict(vuln) {
  if (!vuln) return ''
  if (vuln.fixedByRange) return `🟢 fixed by in-range bump`
  if (vuln.fixedByLatest) return `🟠 fixed only by major (latest)`
  return `🔴 not fixed by any upgrade`
}

function severityBadge(sev) {
  const map = {
    critical: '🟣 critical',
    high: '🔴 high',
    moderate: '🟠 moderate',
    low: '🟡 low',
    info: 'ℹ️ info',
  }
  return map[sev] ?? sev
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|')
}

function render(report) {
  const { summary, outdated } = report
  const lines = []

  // Packages with a major beyond the applied in-range bump. Under the default minor policy the
  // major jump is listed but not applied; a package may appear here even though its in-range part
  // was applied (e.g. axios ^0.27 → 0.33 applied, but 1.x major still available).
  const majorOnly = outdated.filter((e) => e.hasMajorUpdate)

  lines.push('## 📦 Dependency upgrades')
  lines.push('')
  lines.push(
    `Scanned **${summary.total}** packages — **${summary.outdated}** outdated ` +
      `(${summary.major} major, ${summary.vulnerable} with known vulnerabilities).`
  )
  lines.push('')

  if (outdated.length === 0) {
    lines.push('Everything is up to date. 🎉')
    return lines.join('\n')
  }

  // ---- Upgrades table ----
  lines.push('### Updates')
  lines.push('')
  lines.push('| Package | Current | → In-range | Latest | Type | Major? | Security |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const e of outdated) {
    const major = e.hasMajorUpdate ? '⚠️ yes' : '—'
    const security = e.vulnerability ? vulnVerdict(e.vulnerability) : '—'
    lines.push(
      `| \`${escapeCell(e.name)}\` | ${escapeCell(e.current)} | ${escapeCell(e.range)} | ` +
        `${escapeCell(e.latest)} | ${escapeCell(e.type)} | ${major} | ${security} |`
    )
  }
  lines.push('')

  // ---- Security section (the hook) ----
  const vulnerable = outdated.filter((e) => e.vulnerability)
  if (vulnerable.length > 0) {
    lines.push('### 🔒 Security')
    lines.push('')
    for (const e of vulnerable) {
      const v = e.vulnerability
      lines.push(
        `- **${e.name}** — ${v.count} advisory(ies), highest ${severityBadge(v.highestSeverity)} — ${vulnVerdict(v)}`
      )
      for (const adv of v.advisories) {
        const fix = adv.fixedByRange
          ? 'cleared by in-range bump'
          : adv.fixedByLatest
            ? 'cleared only by major'
            : 'not cleared by upgrade'
        lines.push(
          `  - [${escapeCell(adv.title)}](${adv.url}) (${severityBadge(adv.severity)}, affects \`${escapeCell(adv.vulnerableVersions)}\`) — ${fix}`
        )
      }
    }
    lines.push('')
  }

  // ---- Skipped majors ----
  if (majorOnly.length > 0) {
    lines.push('### ⏭️ Major updates available (not applied)')
    lines.push('')
    lines.push(
      'A new **major** version exists beyond the in-range bump above. Under the default `minor` policy the major jump is **not applied** — review and bump deliberately:'
    )
    lines.push('')
    for (const e of majorOnly) {
      lines.push(`- \`${e.name}\` (current \`${e.current}\`) → **${e.latest}** (${e.type})`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('🤖 Opened by [inup](https://github.com/donfear/inup). Re-runs update this same PR.')

  return lines.join('\n')
}

try {
  const report = readInput()
  process.stdout.write(render(report) + '\n')
} catch (err) {
  process.stderr.write(`render-pr-body: ${err instanceof Error ? err.message : String(err)}\n`)
  // Fall back to a minimal body so the Action can still open a PR.
  process.stdout.write('## 📦 Dependency upgrades\n\nSee the diff for upgraded dependencies.\n')
}
