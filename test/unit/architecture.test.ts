import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Architecture boundary rules for the feature-first layout:
 *
 *   cli.ts / index.ts  →  app/  →  features/*  →  shared/
 *
 * Feature dependency policy (everything else is forbidden):
 *   interactive → audit, changelog, debug
 *   upgrade     → debug
 *   headless    → upgrade, audit, debug
 *   audit, changelog, debug → (leaf features: shared only)
 *
 * Cross-feature imports must go through the target feature's index.ts;
 * a feature never imports its own index.ts. Import cycles are Biome's
 * noImportCycles. Type-only imports count here: a boundary is a boundary.
 */
const ALLOWED_FEATURE_DEPS: Record<string, string[]> = {
  audit: [],
  changelog: [],
  debug: [],
  upgrade: ['debug'],
  headless: ['upgrade', 'audit', 'debug'],
  interactive: ['audit', 'changelog', 'debug'],
}

const ROOT = resolve(__dirname, '../..')
const SRC = join(ROOT, 'src')

interface Edge {
  from: string
  to: string
}

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSources(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const target = resolve(dirname(fromFile), specifier)
  // Non-source imports (package.json via resolveJsonModule) sit outside the layering.
  if (!target.startsWith(`${SRC}${sep}`) || /\.json$/.test(target)) return null
  const base = target.replace(/\.js$/, '')
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Unresolved import '${specifier}' in ${toRepoPath(fromFile)}`)
}

/** Repo-relative with forward slashes, so the rules below read the same on Windows. */
const toRepoPath = (path: string) => relative(ROOT, path).split(sep).join('/')

function collectEdges(): Edge[] {
  return listSources(SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return [...source.matchAll(SPECIFIER)].flatMap(([, specifier]) => {
      const target = resolveLocal(file, specifier)
      return target ? [{ from: toRepoPath(file), to: toRepoPath(target) }] : []
    })
  })
}

const featureOf = (path: string) => /^src\/features\/([^/]+)\//.exec(path)?.[1]
const isEntryOrApp = (path: string) => /^src\/app\/|^src\/(cli|index)\.ts$/.test(path)

/** Returns a description of every rule the edge breaks (empty when allowed). */
function violations({ from, to }: Edge): string[] {
  const broken: string[] = []
  const fromFeature = featureOf(from)
  const toFeature = featureOf(to)

  if (from.startsWith('src/shared/') && (isEntryOrApp(to) || toFeature)) {
    broken.push('shared/ is the bottom layer and must not import app, features, or entry points')
  }
  if (fromFeature && isEntryOrApp(to)) {
    broken.push('features must not import the composition root or entry points')
  }
  if (fromFeature && toFeature && fromFeature !== toFeature) {
    if (to !== `src/features/${toFeature}/index.ts`) {
      broken.push("another feature's internals are private — import its index.ts")
    }
    if (!ALLOWED_FEATURE_DEPS[fromFeature]?.includes(toFeature)) {
      broken.push(`${fromFeature} may not depend on ${toFeature}`)
    }
  }
  if (
    fromFeature &&
    fromFeature === toFeature &&
    to === `src/features/${fromFeature}/index.ts` &&
    from !== to
  ) {
    broken.push('a feature must not import its own index.ts (circular-import risk)')
  }
  return broken
}

describe('architecture boundaries', () => {
  const edges = collectEdges()

  it('scans the real source tree', () => {
    // Guards against a silent pass: a broken scan must not report "no violations".
    expect(edges.length).toBeGreaterThan(200)
    expect(Object.keys(ALLOWED_FEATURE_DEPS).sort()).toEqual(
      readdirSync(join(SRC, 'features')).sort()
    )
  })

  it('has no boundary violations', () => {
    const found = edges.flatMap((edge) =>
      violations(edge).map((rule) => `${edge.from} → ${edge.to}: ${rule}`)
    )
    expect(found).toEqual([])
  })

  it.each([
    ['src/shared/fs/scan.ts', 'src/app/upgrade-runner.ts'],
    ['src/shared/fs/scan.ts', 'src/features/audit/index.ts'],
    ['src/features/audit/presenter.ts', 'src/cli.ts'],
    ['src/features/interactive/x.ts', 'src/features/audit/presenter.ts'],
    ['src/features/interactive/x.ts', 'src/features/upgrade/index.ts'],
    ['src/features/audit/presenter.ts', 'src/features/audit/index.ts'],
  ])('flags %s → %s', (from, to) => {
    expect(violations({ from, to })).not.toEqual([])
  })

  it.each([
    ['src/app/upgrade-runner.ts', 'src/features/interactive/index.ts'],
    ['src/features/headless/x.ts', 'src/features/upgrade/index.ts'],
    ['src/features/audit/presenter.ts', 'src/features/audit/y.ts'],
    ['src/features/audit/index.ts', 'src/features/audit/presenter.ts'],
    ['src/features/audit/presenter.ts', 'src/shared/fs/scan.ts'],
  ])('allows %s → %s', (from, to) => {
    expect(violations({ from, to })).toEqual([])
  })
})
