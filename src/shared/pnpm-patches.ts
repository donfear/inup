import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { parse } from 'yaml'
import { debugLog } from './debug-logger'
import { findUp } from './fs/find-up'
import { stripBom } from './fs/io'
import { PNPM_WORKSPACE_FILE } from './pnpm-catalogs'

/** package name → the version selectors its patches are pinned to (`16.3.5`, `^2.0.0`). */
type PatchSelectors = Map<string, string[]>

/**
 * The version-pinned entries of pnpm's `patchedDependencies`.
 *
 * A patch keyed `next@16.3.5` applies to that version only. Bump `next` past it and the patch
 * matches nothing, which pnpm refuses to install (ERR_PNPM_UNUSED_PATCH) — and installing
 * without the patch would silently drop a fix someone wrote on purpose. So such a package is
 * never upgraded unattended, and the picker says so before a person selects it.
 *
 * Name-only keys (`next`) apply to every version and never block.
 */
export class PnpmPatches {
  /** Keyed by the directory asked about; workspace members share their root's entry. */
  private readonly byDir = new Map<string, PatchSelectors>()

  /** The version selectors `name`'s patches are pinned to, for the project owning `startDir`. */
  pinsFor(startDir: string, name: string): string[] | undefined {
    let selectors = this.byDir.get(startDir)
    if (!selectors) {
      const rootDir = findPatchRoot(startDir)
      selectors = this.byDir.get(rootDir) ?? loadPatchSelectors(rootDir)
      this.byDir.set(rootDir, selectors)
      this.byDir.set(startDir, selectors)
    }
    return selectors.get(name)
  }
}

/**
 * The patch key that upgrading `name` to `version` would orphan, or null when the upgrade is
 * safe: the package has no pinned patch, or one of them still covers the new version.
 */
export function findBlockingPatch(
  name: string,
  pins: readonly string[] | undefined,
  version: string
): string | null {
  if (!pins || pins.some((selector) => semver.satisfies(version, selector))) return null
  return `${name}@${pins[0]}`
}

/** The directory holding the nearest pnpm-workspace.yaml, else `startDir` itself. */
function findPatchRoot(startDir: string): string {
  return (
    findUp(startDir, (dir) => (existsSync(join(dir, PNPM_WORKSPACE_FILE)) ? dir : undefined)) ??
    startDir
  )
}

/**
 * Read `patchedDependencies` from the project rooted at `rootDir`: its pnpm-workspace.yaml, and
 * the `pnpm` field of the package.json beside it (where pnpm < 10 keeps the setting).
 * A missing or broken file means no patches — it must never break an upgrade.
 */
function loadPatchSelectors(rootDir: string): PatchSelectors {
  const selectors: PatchSelectors = new Map()
  const collect = (path: string, read: (raw: string) => unknown) => {
    try {
      const patched = read(readFileSync(path, 'utf8'))
      if (!patched || typeof patched !== 'object' || Array.isArray(patched)) return
      for (const key of Object.keys(patched)) {
        // A leading `@` belongs to a scoped name; only a later one separates the selector.
        const at = key.lastIndexOf('@')
        if (at <= 0) continue
        const selector = key.slice(at + 1)
        if (semver.validRange(selector) === null) continue
        const name = key.slice(0, at)
        selectors.set(name, [...(selectors.get(name) ?? []), selector])
      }
    } catch (error) {
      debugLog.warn('PnpmPatches', `failed to read patchedDependencies from ${path}: ${error}`)
    }
  }

  const workspaceFile = join(rootDir, PNPM_WORKSPACE_FILE)
  if (existsSync(workspaceFile)) {
    collect(
      workspaceFile,
      (raw) => (parse(raw) as { patchedDependencies?: unknown } | null)?.patchedDependencies
    )
  }
  const manifestPath = join(rootDir, 'package.json')
  if (existsSync(manifestPath)) {
    collect(
      manifestPath,
      (raw) =>
        (JSON.parse(stripBom(raw)) as { pnpm?: { patchedDependencies?: unknown } }).pnpm
          ?.patchedDependencies
    )
  }
  return selectors
}
