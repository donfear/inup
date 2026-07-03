import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PnpmCatalogs,
  isCatalogReference,
  writeCatalogUpdates,
} from '../../../src/shared/pnpm-catalogs'

const FIXTURE = `# workspace layout
packages:
  - packages/*

# shared dependency ranges
catalog:
  react: ^18.2.0
  lodash: ^4.17.0 # keep in sync with legacy app

catalogs:
  react19:
    react: ^19.0.0
`

describe('pnpm-catalogs', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-catalogs-test-'))
  })

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  const writeWorkspaceFile = (content: string): string => {
    const path = join(testDir, 'pnpm-workspace.yaml')
    writeFileSync(path, content)
    return path
  }

  describe('isCatalogReference', () => {
    it('matches the catalog protocol only', () => {
      expect(isCatalogReference('catalog:')).toBe(true)
      expect(isCatalogReference('catalog:react19')).toBe(true)
      expect(isCatalogReference('^1.0.0')).toBe(false)
      expect(isCatalogReference('workspace:*')).toBe(false)
    })
  })

  describe('PnpmCatalogs.load', () => {
    it('loads default and named catalogs from the nearest workspace file', () => {
      const path = writeWorkspaceFile(FIXTURE)
      const nested = join(testDir, 'packages', 'app')
      mkdirSync(nested, { recursive: true })

      const catalogs = PnpmCatalogs.load(nested)

      expect(catalogs).not.toBeNull()
      expect(catalogs!.path).toBe(path)
      expect(catalogs!.resolve('react', 'catalog:')).toEqual({
        catalog: 'default',
        range: '^18.2.0',
      })
      expect(catalogs!.resolve('react', 'catalog:react19')).toEqual({
        catalog: 'react19',
        range: '^19.0.0',
      })
    })

    it('returns null when there is no workspace file', () => {
      expect(PnpmCatalogs.load(testDir)).toBeNull()
    })

    it('returns null when the workspace file defines no catalogs', () => {
      writeWorkspaceFile('packages:\n  - packages/*\n')
      expect(PnpmCatalogs.load(testDir)).toBeNull()
    })

    it('returns null instead of throwing on malformed yaml', () => {
      writeWorkspaceFile('catalog: [unclosed\n  - {{{')
      expect(PnpmCatalogs.load(testDir)).toBeNull()
    })
  })

  describe('entriesOf', () => {
    it('lists every entry of a catalog and returns [] for unknown ones', () => {
      writeWorkspaceFile(FIXTURE)
      const catalogs = PnpmCatalogs.load(testDir)!

      expect(catalogs.entriesOf('default')).toEqual([
        { name: 'react', range: '^18.2.0' },
        { name: 'lodash', range: '^4.17.0' },
      ])
      expect(catalogs.entriesOf('react19')).toEqual([{ name: 'react', range: '^19.0.0' }])
      expect(catalogs.entriesOf('missing')).toEqual([])
    })
  })

  describe('resolve', () => {
    it('resolves catalog:default to the default catalog and misses cleanly', () => {
      writeWorkspaceFile(FIXTURE)
      const catalogs = PnpmCatalogs.load(testDir)!

      expect(catalogs.resolve('react', 'catalog:default')).toEqual({
        catalog: 'default',
        range: '^18.2.0',
      })
      expect(catalogs.resolve('lodash', 'catalog:react19')).toBeNull() // not in that catalog
      expect(catalogs.resolve('zod', 'catalog:')).toBeNull() // not in any catalog
      expect(catalogs.resolve('react', 'catalog:missing')).toBeNull() // catalog does not exist
      expect(catalogs.resolve('react', '^18.0.0')).toBeNull() // not a catalog ref
    })
  })

  describe('writeCatalogUpdates', () => {
    it('rewrites targeted ranges while preserving comments and untouched entries', () => {
      const path = writeWorkspaceFile(FIXTURE)

      writeCatalogUpdates(path, [
        { catalog: 'default', name: 'react', range: '^18.3.1' },
        { catalog: 'react19', name: 'react', range: '^19.2.0' },
      ])

      const raw = readFileSync(path, 'utf8')
      expect(raw).toContain('react: ^18.3.1')
      expect(raw).toContain('react: ^19.2.0')
      // Untouched content and comments survive the round-trip.
      expect(raw).toContain('# workspace layout')
      expect(raw).toContain('# shared dependency ranges')
      expect(raw).toContain('lodash: ^4.17.0 # keep in sync with legacy app')
      expect(raw).toContain('- packages/*')
      // The old ranges are gone.
      expect(raw).not.toContain('^18.2.0')
      expect(raw).not.toContain('^19.0.0')
    })

    it('writes the default catalog to catalogs.default when declared there', () => {
      const path = writeWorkspaceFile('catalogs:\n  default:\n    react: ^18.2.0\n')

      writeCatalogUpdates(path, [{ catalog: 'default', name: 'react', range: '^18.3.1' }])

      const raw = readFileSync(path, 'utf8')
      expect(raw).toContain('react: ^18.3.1')
      expect(raw).not.toContain('^18.2.0')
      expect(raw).not.toMatch(/^catalog:/m) // no top-level catalog map invented
    })

    it('skips entries that no longer exist instead of inventing structure', () => {
      const path = writeWorkspaceFile(FIXTURE)

      writeCatalogUpdates(path, [{ catalog: 'default', name: 'ghost', range: '^1.0.0' }])

      const raw = readFileSync(path, 'utf8')
      expect(raw).not.toContain('ghost')
      expect(raw).toContain('react: ^18.2.0')
    })

    it('preserves quote style on updated and untouched entries', () => {
      const path = writeWorkspaceFile('catalog:\n  react: "^18.2.0"\n  lodash: "^4.17.0"\n')

      writeCatalogUpdates(path, [{ catalog: 'default', name: 'react', range: '^18.3.1' }])

      const raw = readFileSync(path, 'utf8')
      expect(raw).toContain('react: "^18.3.1"')
      expect(raw).toContain('lodash: "^4.17.0"')
    })

    it('applies the surviving updates even when some entries are missing', () => {
      const path = writeWorkspaceFile(FIXTURE)

      writeCatalogUpdates(path, [
        { catalog: 'default', name: 'ghost', range: '^1.0.0' },
        { catalog: 'default', name: 'react', range: '^18.3.1' },
      ])

      const raw = readFileSync(path, 'utf8')
      expect(raw).not.toContain('ghost')
      expect(raw).toContain('react: ^18.3.1')
    })
  })

  describe('malformed catalog values', () => {
    it('ignores non-string and empty values without crashing', () => {
      // YAML parses an unquoted `18` as a number and a bare key as null;
      // neither is a usable range, and neither may break the load.
      writeWorkspaceFile('catalog:\n  react: 18\n  lodash:\n  zod: ^3.0.0\n')

      const catalogs = PnpmCatalogs.load(testDir)!

      expect(catalogs.resolve('zod', 'catalog:')).toEqual({ catalog: 'default', range: '^3.0.0' })
      expect(catalogs.resolve('react', 'catalog:')).toBeNull()
      expect(catalogs.resolve('lodash', 'catalog:')).toBeNull()
    })

    it('returns null for structurally garbage catalog shapes', () => {
      writeWorkspaceFile('catalog:\n  - not\n  - a-map\ncatalogs: nope\n')

      expect(PnpmCatalogs.load(testDir)).toBeNull()
    })
  })
})
