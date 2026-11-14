import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildConfigTemplate,
  INIT_CONFIG_FILENAME,
  schemaUrl,
  writeInitConfig,
} from '../../../../src/shared/config/init-config'
import { PACKAGE_VERSION } from '../../../../src/shared/config/package-meta'
import { KNOWN_KEYS, loadProjectConfig } from '../../../../src/shared/config/project-config'

// Lets one test make the template write fail, to prove the old config survives it.
const writeAtomic = vi.hoisted(() => ({ fail: false }))
vi.mock('../../../../src/shared/fs/write-atomic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/shared/fs/write-atomic')>()
  return {
    writeFileAtomic: (path: string, content: string) => {
      if (writeAtomic.fail) throw new Error('ENOSPC: no space left on device')
      actual.writeFileAtomic(path, content)
    },
  }
})

describe('buildConfigTemplate', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `inup-init-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('produces a file the config loader parses without warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(testDir, INIT_CONFIG_FILENAME), buildConfigTemplate())

    const config = loadProjectConfig(testDir)

    // A parse failure would surface as a warning and an empty config; the
    // template's empty arrays/false booleans must round-trip instead.
    expect(warn).not.toHaveBeenCalled()
    expect(config.ignore).toEqual([])
    expect(config.exclude).toEqual([])
    expect(config.scanDirs).toEqual([])
    expect(config.showPeerDependencyVulnerabilities).toBe(false)
    expect(config.showOptionalDependencyVulnerabilities).toBe(false)
    // concurrency ships commented out — enabling it would pin parallelism.
    expect(config.concurrency).toBeUndefined()
    // native ships commented out — the core stays on by default.
    expect(config.native).toBeUndefined()
    // only ships commented out — a filter on by default would hide packages.
    expect(config.only).toBeUndefined()
    // verify ships commented out — not every project has tests to run.
    expect(config.verify).toBeUndefined()
    warn.mockRestore()
  })

  it('documents every field the loader reads', () => {
    // Iterates the loader's own list: test files are not type-checked, so a typed
    // Record here would not catch a field added to the interface.
    const template = buildConfigTemplate()
    for (const field of Object.keys(KNOWN_KEYS)) {
      expect(template).toContain(`"${field}"`)
    }
  })

  it('points "$schema" at the schema for this version, as its first field', () => {
    const firstField = buildConfigTemplate()
      .split('\n')
      .find((line) => line.trimStart().startsWith('"'))
    expect(firstField).toBe(`  "$schema": "${schemaUrl(PACKAGE_VERSION)}",`)
  })

  it('still parses with CRLF line endings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(testDir, INIT_CONFIG_FILENAME), buildConfigTemplate().replace(/\n/g, '\r\n'))

    expect(loadProjectConfig(testDir).ignore).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  describe('uncommenting optional fields', () => {
    // Every field the template ships commented out, and what it loads as once enabled.
    const OPTIONAL_FIELDS: Record<string, unknown> = {
      only: ['@myco/*'],
      minimumReleaseAge: 10080,
      minimumReleaseAgeExclude: ['@myco/*'],
      concurrency: 4,
      native: false,
      verify: 'npm test',
    }
    const COMMENTED_FIELD = /^(\s*)\/\/ ("(\w+)":.*)$/

    /** The template with `fields` enabled the way a user would: by deleting the `// `. */
    const uncomment = (fields: string[]) =>
      buildConfigTemplate()
        .split('\n')
        .map((line) => {
          const match = COMMENTED_FIELD.exec(line)
          return match && fields.includes(match[3]) ? match[1] + match[2] : line
        })
        .join('\n')

    const names = Object.keys(OPTIONAL_FIELDS)
    // Every non-empty subset: each field alone, every combination, and all of them together.
    const subsets = Array.from({ length: 2 ** names.length - 1 }, (_, i) => {
      const fields = names.filter((_, bit) => (i + 1) & (1 << bit))
      return { fields, label: fields.join(' + ') }
    })

    it('ships exactly these fields commented out', () => {
      const commented = buildConfigTemplate()
        .split('\n')
        .flatMap((line) => COMMENTED_FIELD.exec(line)?.[3] ?? [])
      expect(commented).toEqual(names)
    })

    it.each(subsets)('still parses with $label uncommented', ({ fields }) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(testDir, INIT_CONFIG_FILENAME), uncomment(fields))

      const config = loadProjectConfig(testDir) as Record<string, unknown>

      expect(warn).not.toHaveBeenCalled()
      for (const field of fields) expect(config[field]).toEqual(OPTIONAL_FIELDS[field])
      expect(config.showOptionalDependencyVulnerabilities).toBe(false)
      warn.mockRestore()
    })
  })

  it('stamps the generating inup version and the docs URL in the header', () => {
    const template = buildConfigTemplate()
    expect(
      template.startsWith(`// inup.config.jsonc — generated by inup v${PACKAGE_VERSION}`)
    ).toBe(true)
    expect(template).toContain(
      'https://github.com/donfear/inup/blob/main/docs/guide/configuration.md'
    )
  })
})

describe('schemaUrl', () => {
  it.each([
    ['1.10.0', 'https://cdn.jsdelivr.net/npm/inup@1/config-schema.json'],
    ['1.9.0', 'https://cdn.jsdelivr.net/npm/inup@1/config-schema.json'],
    ['2.0.0', 'https://cdn.jsdelivr.net/npm/inup@2/config-schema.json'],
    // A range like @2 never matches a prerelease, so it would 404 until 2.0.0 ships.
    ['2.0.0-rc.1', 'https://cdn.jsdelivr.net/npm/inup@2.0.0-rc.1/config-schema.json'],
    ['1.10.0-beta.0', 'https://cdn.jsdelivr.net/npm/inup@1.10.0-beta.0/config-schema.json'],
  ])('%s -> %s', (version, url) => {
    expect(schemaUrl(version)).toBe(url)
  })
})

describe('writeInitConfig', () => {
  let testDir: string
  const OLD_NAMES = ['.inuprc', '.inuprc.json', 'inup.config.json']

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `inup-write-init-${process.pid}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(testDir, { recursive: true })
    writeAtomic.fail = false
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('writes inup.config.jsonc into an empty directory', () => {
    const result = writeInitConfig(testDir)

    expect(result).toEqual({ path: join(testDir, 'inup.config.jsonc'), removed: [] })
    expect(readdirSync(testDir)).toEqual(['inup.config.jsonc'])
    expect(readFileSync(result.path, 'utf-8')).toBe(buildConfigTemplate())
  })

  it('overwrites an existing inup.config.jsonc in place', () => {
    writeFileSync(join(testDir, 'inup.config.jsonc'), '{"ignore": ["mine"]}')

    expect(writeInitConfig(testDir).removed).toEqual([])
    expect(readdirSync(testDir)).toEqual(['inup.config.jsonc'])
    expect(readFileSync(join(testDir, 'inup.config.jsonc'), 'utf-8')).toBe(buildConfigTemplate())
  })

  it.each(OLD_NAMES)('replaces %s, leaving exactly one config', (name) => {
    writeFileSync(join(testDir, name), '{"ignore": ["mine"]}')

    expect(writeInitConfig(testDir).removed).toEqual([join(testDir, name)])
    expect(readdirSync(testDir)).toEqual(['inup.config.jsonc'])
  })

  it('replaces several configs at once', () => {
    for (const name of [...OLD_NAMES, 'inup.config.jsonc']) writeFileSync(join(testDir, name), '{}')

    expect(writeInitConfig(testDir).removed).toEqual(OLD_NAMES.map((name) => join(testDir, name)))
    expect(readdirSync(testDir)).toEqual(['inup.config.jsonc'])
  })

  it('leaves unrelated files alone', () => {
    writeFileSync(join(testDir, 'package.json'), '{}')
    writeFileSync(join(testDir, '.inuprc'), '{}')

    writeInitConfig(testDir)
    expect(readdirSync(testDir).sort()).toEqual(['inup.config.jsonc', 'package.json'])
  })

  it('keeps the old config when the write fails', () => {
    writeFileSync(join(testDir, '.inuprc'), '{"ignore": ["mine"]}')
    writeAtomic.fail = true

    expect(() => writeInitConfig(testDir)).toThrow('ENOSPC')
    expect(readdirSync(testDir)).toEqual(['.inuprc'])
    expect(readFileSync(join(testDir, '.inuprc'), 'utf-8')).toBe('{"ignore": ["mine"]}')
  })

  it('refuses, touching nothing, when a config path is a directory', () => {
    writeFileSync(join(testDir, '.inuprc'), '{"ignore": ["mine"]}')
    mkdirSync(join(testDir, 'inup.config.json'))

    expect(() => writeInitConfig(testDir)).toThrow(
      `${join(testDir, 'inup.config.json')} is not a regular file`
    )
    expect(readdirSync(testDir).sort()).toEqual(['.inuprc', 'inup.config.json'])
    expect(readFileSync(join(testDir, '.inuprc'), 'utf-8')).toBe('{"ignore": ["mine"]}')
  })

  it.skipIf(process.platform === 'win32')(
    'refuses, touching nothing, when a config path is a symlink',
    () => {
      writeFileSync(join(testDir, 'real.json'), '{}')
      symlinkSync(join(testDir, 'real.json'), join(testDir, '.inuprc'))

      expect(() => writeInitConfig(testDir)).toThrow(
        `${join(testDir, '.inuprc')} is not a regular file`
      )
      expect(readdirSync(testDir).sort()).toEqual(['.inuprc', 'real.json'])
    }
  )
})
