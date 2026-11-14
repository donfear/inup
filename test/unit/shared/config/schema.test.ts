import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Ajv from 'ajv'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POOL_CONNECTIONS } from '../../../../src/shared/config/constants'
import { buildConfigTemplate } from '../../../../src/shared/config/init-config'
import {
  IGNORED_KEYS,
  KNOWN_KEYS,
  loadProjectConfig,
} from '../../../../src/shared/config/project-config'

// config-schema.json is what editors validate inup.config.jsonc against. These tests keep
// it in step with the loader, which stays the authority on what a config means.
const SCHEMA_PATH = resolve(__dirname, '../../../../config-schema.json')
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))

interface PropertySchema {
  type: string
  description?: string
  minimum?: number
  maximum?: number
}
const properties = schema.properties as Record<string, PropertySchema>

/** Strict mode rejects unknown keywords, so a typo like "maximun" fails the compile. */
function compileStrict() {
  const ajv = new Ajv({ strict: true, allErrors: true })
  // VS Code-only keywords, not standard JSON Schema: allow comments and trailing commas,
  // and word the message for a value that fails "pattern".
  ajv.addKeyword({ keyword: 'allowComments', schemaType: 'boolean' })
  ajv.addKeyword({ keyword: 'allowTrailingCommas', schemaType: 'boolean' })
  ajv.addKeyword({ keyword: 'patternErrorMessage', schemaType: 'string' })
  return ajv.compile(schema)
}

describe('config-schema.json', () => {
  it('compiles as a strict draft-07 schema', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
    expect(() => compileStrict()).not.toThrow()
  })

  it('allows comments and trailing commas, as the loader does', () => {
    expect(schema.allowComments).toBe(true)
    expect(schema.allowTrailingCommas).toBe(true)
  })

  it('has no $id, which would have to carry a version and go stale on release', () => {
    expect(schema.$id).toBeUndefined()
  })

  it('describes exactly the keys the loader accepts', () => {
    expect(Object.keys(properties).sort()).toEqual(
      [...Object.keys(KNOWN_KEYS), ...IGNORED_KEYS].sort()
    )
    expect(schema.additionalProperties).toBe(false)
  })

  it.each(Object.keys(properties))('documents "%s" for editor hovers', (key) => {
    expect(properties[key].description?.trim()).toBeTruthy()
  })

  it('uses the loader’s ranges', () => {
    expect(properties.concurrency).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: POOL_CONNECTIONS,
    })
    expect(properties.minimumReleaseAge).toMatchObject({ type: 'integer', minimum: 0 })
  })

  it('accepts the --init template with every optional field enabled', () => {
    const validate = compileStrict()
    // Deleting each `// ` in front of a field, the way the template says to enable one.
    const enabled = buildConfigTemplate().replace(/^(\s*)\/\/ ("\w+":.*)$/gm, '$1$2')
    const parsed = JSON.parse(
      enabled.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
    ) as Record<string, unknown>

    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(Object.keys(KNOWN_KEYS)))
    expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true)
  })
})

describe('config-schema.json agrees with the loader', () => {
  let testDir: string
  let warn: ReturnType<typeof vi.spyOn>
  const validate = compileStrict()

  beforeEach(() => {
    testDir = join(tmpdir(), `inup-schema-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** What the loader makes of `config`: the normalized result and whether it warned. */
  function load(config: Record<string, unknown>) {
    warn.mockClear()
    writeFileSync(join(testDir, 'inup.config.jsonc'), JSON.stringify(config))
    const loaded = loadProjectConfig(testDir) as Record<string, unknown>
    return { loaded, warned: warn.mock.calls.length > 0 }
  }

  // Edge values for every field: boundaries, wrong types, blank strings, mixed lists.
  const VALUES: unknown[] = [
    0,
    1,
    24,
    25,
    -1,
    1.5,
    4.0,
    1e21,
    '4',
    '',
    '  ',
    'npm test',
    null,
    true,
    false,
    [],
    ['a', '@scope/*'],
    ['a', 1],
    {},
  ]
  const cases = Object.keys(KNOWN_KEYS).flatMap((key) =>
    VALUES.map((value) => ({ key, value, label: `${key} = ${JSON.stringify(value)}` }))
  )

  it.each(cases)('$label', ({ key, value }) => {
    const valid = validate({ [key]: value })
    const { loaded, warned } = load({ [key]: value })

    // Valid to the editor means inup takes it as written, without a word.
    if (valid) {
      expect(warned).toBe(false)
      expect(loaded[key]).toEqual(value)
    }
    // Anything inup warns about, the editor flags too. (The schema may be stricter: values
    // the loader drops quietly, such as a non-string in a list, are still flagged.)
    if (warned) expect(valid).toBe(false)
  })

  it('flags an unknown key exactly when the loader warns about it', () => {
    for (const key of ['minimumReleaseAg', 'theme', 'schema']) {
      expect(validate({ [key]: 1 })).toBe(false)
      expect(load({ [key]: 1 }).warned).toBe(true)
    }
  })

  it('accepts "$schema" in both', () => {
    const config = { $schema: 'https://cdn.jsdelivr.net/npm/inup@1/config-schema.json' }
    expect(validate(config)).toBe(true)
    expect(load(config)).toEqual({ loaded: {}, warned: false })
  })
})
