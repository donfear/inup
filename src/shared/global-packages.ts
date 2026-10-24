import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as semver from 'semver'
import type { PackageManager } from './types'

/**
 * How each package manager lists and installs global packages. Yarn 2+ has no global installs,
 * and Yarn 1's `yarn global list` has no machine-readable output, so Yarn is left out.
 */
const GLOBAL_COMMANDS: Partial<Record<PackageManager, { list: string; add: string }>> = {
  npm: { list: 'npm ls -g --depth=0 --json', add: 'npm install -g' },
  pnpm: { list: 'pnpm ls -g --depth=0 --json', add: 'pnpm add -g' },
  bun: { list: 'bun pm ls -g', add: 'bun add -g' },
}

function commandsFor(pm: PackageManager): { list: string; add: string } {
  const commands = GLOBAL_COMMANDS[pm]
  if (!commands) {
    throw new Error(`inup can't upgrade ${pm} global packages: use -g with npm, pnpm or bun.`)
  }
  return commands
}

/** The command that installs global packages at the given `name@version` specs. */
export function globalAddCommand(pm: PackageManager, specs: string[]): string {
  return [commandsFor(pm).add, ...specs].join(' ')
}

type DependencyMap = Record<string, { version?: string }> | undefined

const versionsOf = (dependencies: DependencyMap): Array<[string, string | undefined]> =>
  Object.entries(dependencies ?? {}).map(([name, dep]) => [name, dep.version])

/**
 * `name → installed version` from a package manager's global listing. Linked packages and
 * anything else without a plain version are left out: there is no registry version to compare.
 */
export function parseGlobalPackages(pm: PackageManager, output: string): Record<string, string> {
  let entries: Array<[string, string | undefined]>
  if (pm === 'bun') {
    // ├── typescript@5.4.5
    entries = [...output.matchAll(/^[├└]── (.+)@([^@\s]+)$/gmu)].map((match) => [
      match[1],
      match[2],
    ])
  } else {
    const parsed = JSON.parse(output) as
      | { dependencies?: DependencyMap }
      | Array<{ dependencies?: DependencyMap }>
    entries = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((root) =>
      versionsOf(root.dependencies)
    )
  }
  const packages: Record<string, string> = {}
  for (const [name, version] of entries) {
    if (version && semver.valid(version)) packages[name] = version
  }
  return packages
}

/** The globally installed packages, from the package manager itself. */
export function listGlobalPackages(pm: PackageManager): Record<string, string> {
  const command = commandsFor(pm).list
  const result = spawnSync(command, { encoding: 'utf-8', shell: true })
  // `npm ls` exits 1 over problems like an invalid peer, but still prints the full listing.
  if (!result.stdout?.trim()) {
    const reason = result.error?.message ?? result.stderr?.trim() ?? `exit code ${result.status}`
    throw new Error(`Could not list global packages with \`${command}\`: ${reason}`)
  }
  return parseGlobalPackages(pm, result.stdout)
}

/**
 * A throwaway package.json declaring each global package at `^installed`, so the regular
 * scan finds them with both an in-range and a latest update. Removed when the process exits.
 * Returns its directory.
 */
export function writeGlobalManifest(packages: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'inup-global-'))
  const dependencies = Object.fromEntries(
    Object.entries(packages).map(([name, version]) => [name, `^${version}`])
  )
  const manifest = { name: 'global-packages', private: true, dependencies }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }))
  return dir
}
