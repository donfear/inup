import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse, parseDocument } from 'yaml'
import { debugLog } from './debug-logger'

export const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml'

/** Name pnpm gives the top-level `catalog:` map (also addressable as `catalogs.default`). */
export const DEFAULT_CATALOG = 'default'

export interface CatalogResolution {
  /** Which catalog the range came from (`default` or a named catalog). */
  catalog: string
  /** The version range declared in pnpm-workspace.yaml, e.g. `^18.2.0`. */
  range: string
}

/** `catalog:` (default) or `catalog:<name>` — the pnpm catalog protocol. */
export function isCatalogReference(version: string): boolean {
  return version.startsWith('catalog:')
}

/**
 * The catalog definitions of the nearest `pnpm-workspace.yaml`.
 *
 * Catalogs (pnpm ≥ 9.5) hoist shared version ranges out of the member
 * package.json files: a dependency declared as `"react": "catalog:"` gets its
 * actual range from this file's `catalog:` map (or `catalogs.<name>` for
 * `"catalog:<name>"` references). Upgrading such a dependency therefore means
 * editing pnpm-workspace.yaml, not the referencing package.json.
 */
export class PnpmCatalogs {
  private constructor(
    /** Absolute path of the pnpm-workspace.yaml the catalogs were read from. */
    public readonly path: string,
    /** catalog name → (package name → range). */
    private readonly catalogs: Map<string, Map<string, string>>
  ) {}

  /**
   * Load catalogs from the nearest pnpm-workspace.yaml at or above `startDir`.
   * Returns null when there is no workspace file, it is unreadable, or it
   * defines no catalogs — a broken file must never break a scan.
   */
  static load(startDir: string): PnpmCatalogs | null {
    const path = findPnpmWorkspaceFile(startDir)
    if (!path) return null

    try {
      const raw = parse(readFileSync(path, 'utf8')) as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') return null

      const catalogs = new Map<string, Map<string, string>>()
      const addCatalog = (name: string, value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return
        const entries = new Map<string, string>()
        for (const [pkg, range] of Object.entries(value as Record<string, unknown>)) {
          if (typeof range === 'string') entries.set(pkg, range)
        }
        if (entries.size > 0) catalogs.set(name, entries)
      }

      addCatalog(DEFAULT_CATALOG, raw.catalog)
      if (raw.catalogs && typeof raw.catalogs === 'object' && !Array.isArray(raw.catalogs)) {
        for (const [name, value] of Object.entries(raw.catalogs as Record<string, unknown>)) {
          addCatalog(name, value)
        }
      }

      if (catalogs.size === 0) return null
      return new PnpmCatalogs(path, catalogs)
    } catch (error) {
      debugLog.warn('PnpmCatalogs', `failed to parse ${path}: ${error}`)
      return null
    }
  }

  /**
   * Resolve a `catalog:` / `catalog:<name>` version specifier for `packageName`
   * to the range declared in the workspace file, or null when the reference
   * points at a catalog (or entry) that does not exist.
   */
  resolve(packageName: string, versionSpecifier: string): CatalogResolution | null {
    if (!isCatalogReference(versionSpecifier)) return null
    const name = versionSpecifier.slice('catalog:'.length).trim() || DEFAULT_CATALOG
    const range = this.catalogs.get(name)?.get(packageName)
    return range === undefined ? null : { catalog: name, range }
  }

  /** Every entry declared in the given catalog (empty for unknown catalogs). */
  entriesOf(catalogName: string): Array<{ name: string; range: string }> {
    const entries = this.catalogs.get(catalogName)
    if (!entries) return []
    return Array.from(entries, ([name, range]) => ({ name, range }))
  }
}

/**
 * Write new ranges for catalog entries back into pnpm-workspace.yaml.
 *
 * Edits go through the yaml Document API so comments, key order, and the
 * formatting of untouched nodes survive the round-trip. Entries that no longer
 * exist in the file (edited since the scan) are skipped, never invented.
 */
export function writeCatalogUpdates(
  workspaceFilePath: string,
  updates: Array<{ catalog: string; name: string; range: string }>
): void {
  const raw = readFileSync(workspaceFilePath, 'utf8')
  const doc = parseDocument(raw)

  for (const update of updates) {
    // The default catalog may live under `catalog:` or `catalogs.default:`.
    const candidatePaths =
      update.catalog === DEFAULT_CATALOG
        ? [
            ['catalog', update.name],
            ['catalogs', DEFAULT_CATALOG, update.name],
          ]
        : [['catalogs', update.catalog, update.name]]
    const keyPath = candidatePaths.find((path) => doc.hasIn(path))
    if (!keyPath) {
      debugLog.warn(
        'PnpmCatalogs',
        `catalog entry ${update.catalog}:${update.name} no longer exists in ${workspaceFilePath} — skipping`
      )
      continue
    }
    doc.setIn(keyPath, update.range)
  }

  writeFileSync(workspaceFilePath, doc.toString())
}

/** Nearest pnpm-workspace.yaml at or above `startDir`, or null. */
function findPnpmWorkspaceFile(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = join(dir, PNPM_WORKSPACE_FILE)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
