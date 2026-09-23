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
import { pathToFileURL } from 'node:url'

/** @typedef {import('../src/features/headless/types').HeadlessReport} HeadlessReport */

export function readInput(argv = process.argv, stdin = 0) {
  const path = argv[2]
  const raw = path && path !== '-' ? readFileSync(path, 'utf-8') : readFileSync(stdin, 'utf-8')
  return JSON.parse(raw)
}

/** A short verdict on whether upgrading clears every advisory on this package. */
export function vulnVerdict(vuln) {
  if (!vuln) return ''
  if (vuln.fixedByRange) return `🟢 fixed by in-range bump`
  if (vuln.fixedByLatest) return `🟠 fixed only by major (latest)`
  return `🔴 not fixed by any upgrade`
}

export function severityBadge(sev) {
  const map = {
    critical: '🟣 critical',
    high: '🔴 high',
    moderate: '🟠 moderate',
    low: '🟡 low',
    info: 'ℹ️ info',
  }
  return map[sev] ?? sev
}

export function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|')
}

export function stripVersionPrefix(version) {
  return String(version).replace(/^[^\d]+/, '')
}

export function applyVersionPrefix(current, target) {
  const prefixMatch = String(current).match(/^([^\d]+)/)
  return `${prefixMatch ? prefixMatch[1] : ''}${target}`
}

/**
 * Whether this entry's in-range bump actually changed the version this PR installs. The report has
 * no explicit "applied" flag, so we derive it: under minor/patch, `range` is the version satisfying
 * the current spec, and it's only a real change when it differs from the current spec's version
 * (prefix stripped). Entries where only a major exists have `range === current` and aren't applied.
 * Peer ranges never are: `--apply` does not rewrite peerDependencies.
 */
export function wasApplied(e) {
  if (e.type === 'peerDependencies') return false
  const cleanCurrent = stripVersionPrefix(e.current)
  return e.range !== cleanCurrent && e.range !== e.current
}

/**
 * Where the upgrade is written: the dependency type, plus the pnpm catalog when the range lives in
 * pnpm-workspace.yaml instead of a package.json — reviewers should know the diff touches the
 * workspace file.
 */
export function sourceLabel(e) {
  return e.catalog ? `${e.type} · catalog:${e.catalog}` : e.type
}

/**
 * Collapse monorepo duplicates. The report carries one entry per (package, packageJsonPath, type),
 * so the same upgrade (e.g. @apollo/client ^4.2.1 → 4.2.3) appears once per workspace and again per
 * dependency type. Reviewers only care about the unique change, so we key on name+range+latest and
 * keep the first entry — preserving its vulnerability/major flags, which are package-level facts.
 * Catalog entries stay distinct from same-range direct deps: they are written to different files.
 * Peer entries stay distinct too: they are never written, so one must not stand in for a real bump.
 */
export function dedupe(entries) {
  const seen = new Map()
  for (const e of entries) {
    const peer = e.type === 'peerDependencies' ? '@peer' : ''
    const key = `${e.name}@${e.range}@${e.latest}@${e.catalog ?? ''}${peer}`
    if (!seen.has(key)) seen.set(key, e)
  }
  return [...seen.values()]
}

/** Coarse human age — minutes under an hour, then hours, then days. */
export function formatAge(minutes) {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

/**
 * The release-age cooldown section: versions that exist but were deliberately withheld.
 *
 * Rendered even when nothing else was upgraded. A cooldown that silently skips a version is
 * indistinguishable from being up to date, which would let a reviewer conclude there is
 * nothing newer — the opposite of what a supply-chain control should communicate.
 */
/**
 * A warning when the configured cooldown could not act at all.
 *
 * The policy fails open on missing publish times, so a registry that doesn't expose `time`
 * produces an empty held list — indistinguishable from "every version is old enough". In CI
 * nobody reads stderr, so the PR body is the only place a reviewer would ever learn that the
 * supply-chain guard they configured did nothing.
 */
export function cooldownWarningSection(report) {
  const cooldown = report.cooldown
  if (!cooldown || cooldown.publishTimesAvailable) return []
  return [
    `> [!WARNING]`,
    `> \`minimum-release-age\` is set to **${cooldown.minimumReleaseAge}** minutes, but the registry returned no publish times.`,
    `> The cooldown had **no effect** on this run — every version was treated as eligible.`,
    '',
  ]
}

export function heldSection(report) {
  const held = report.heldByCooldown ?? []
  if (held.length === 0) return []

  // Same monorepo collapse as the upgrades table: one line per unique withheld version.
  const seen = new Map()
  for (const h of held) {
    const key = `${h.name}@${h.version}`
    if (!seen.has(key)) seen.set(key, h)
  }

  const lines = ['### ⏳ Held by release-age cooldown', '']
  lines.push(
    'A newer version exists but is younger than the configured `minimum-release-age`, so it was **not** applied. ' +
      'Freshly published versions are the ones most likely to be a compromised release nobody has caught yet.'
  )
  lines.push('')
  lines.push('| Package | Held version | Published | Clears in | Versions held |')
  lines.push('|---|---|---|---|---|')
  for (const h of seen.values()) {
    lines.push(
      `| \`${escapeCell(h.name)}\` | ${escapeCell(h.version)} | ${formatAge(h.ageMinutes)} ago | ${h.eligibleInMinutes > 0 ? formatAge(h.eligibleInMinutes) : 'next run'} | ${h.count} |`
    )
  }
  lines.push('')
  return lines
}

export function render(report) {
  const { summary } = report
  // Collapse monorepo duplicates up front so every section below counts and lists unique upgrades.
  // summary.outdated counts per-location entries, so it overcounts in workspaces — derive the unique
  // figure from the deduped set instead and report both so the number stays honest.
  const outdated = dedupe(report.outdated)
  const lines = []

  // Packages with a major beyond the applied in-range bump. Under the default minor policy the
  // major jump is listed but not applied; a package may appear here even though its in-range part
  // was applied (e.g. axios ^0.27.0 → 0.27.2 applied, but 0.28+ and 1.x still available).
  const majorOnly = outdated.filter((e) => e.hasMajorUpdate)

  lines.push('## 📦 Dependency upgrades')
  lines.push('')
  const uniqueNote =
    outdated.length !== summary.outdated ? ` (${summary.outdated} across workspaces)` : ''
  lines.push(
    `Scanned **${summary.total}** packages — **${outdated.length}** unique upgrade(s)${uniqueNote} ` +
      `(${majorOnly.length} with a major available, ${outdated.filter((e) => e.vulnerability).length} with known vulnerabilities).`
  )
  lines.push('')

  lines.push(...cooldownWarningSection(report))

  if (outdated.length === 0) {
    const held = heldSection(report)
    if (held.length === 0) {
      lines.push('Everything is up to date. 🎉')
      return lines.join('\n')
    }
    lines.push('No upgrades were applied, but the cooldown is holding versions back.')
    lines.push('')
    lines.push(...held)
    return lines.join('\n')
  }

  // ---- Applied in this PR (the actual change set) ----
  // The table below lists every outdated package; this section calls out the subset whose version
  // this commit actually bumped, so reviewers see what changed without diffing current vs in-range.
  const applied = outdated.filter(wasApplied)
  if (applied.length > 0) {
    lines.push('### ✅ Applied in this PR')
    lines.push('')
    for (const e of applied) {
      lines.push(
        `- \`${e.name}\` \`${e.current}\` → \`${applyVersionPrefix(e.current, e.range)}\` (${sourceLabel(e)})`
      )
    }
    lines.push('')
  } else {
    lines.push('_No in-range upgrades were applied — see skipped majors below._')
    lines.push('')
  }

  // ---- Upgrades table ----
  lines.push('### Updates')
  lines.push('')
  lines.push('| Package | Current | → In-range | Latest | Type | Applied | Major? | Security |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const e of outdated) {
    const major = e.hasMajorUpdate ? '⚠️ yes' : '—'
    const security = e.vulnerability ? vulnVerdict(e.vulnerability) : '—'
    const appliedCell = wasApplied(e) ? '✅' : '—'
    lines.push(
      `| \`${escapeCell(e.name)}\` | ${escapeCell(e.current)} | ${escapeCell(applyVersionPrefix(e.current, e.range))} | ` +
        `${escapeCell(e.latest)} | ${escapeCell(sourceLabel(e))} | ${appliedCell} | ${major} | ${security} |`
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
      lines.push(`- \`${e.name}\` (current \`${e.current}\`) → **${e.latest}** (${sourceLabel(e)})`)
    }
    lines.push('')
  }

  lines.push(...heldSection(report))

  lines.push('---')
  lines.push('')
  lines.push('🤖 Opened by [inup](https://github.com/donfear/inup). Re-runs update this same PR.')

  return lines.join('\n')
}

export function main({
  argv = process.argv,
  stdin = 0,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const report = readInput(argv, stdin)
    stdout.write(`${render(report)}\n`)
  } catch (err) {
    stderr.write(`render-pr-body: ${err}\n`)
    // Fall back to a minimal body so the Action can still open a PR.
    stdout.write('## 📦 Dependency upgrades\n\nSee the diff for upgraded dependencies.\n')
  }
}

export function isDirectRun(argv = process.argv, moduleUrl = import.meta.url) {
  const entry = argv[1]
  return Boolean(entry && moduleUrl === pathToFileURL(entry).href)
}

/* v8 ignore next 3 -- process entrypoint; main() is tested directly */
if (isDirectRun()) {
  main()
}
