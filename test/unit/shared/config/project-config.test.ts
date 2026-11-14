import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_FILES,
  findConfigFilesIn,
  isPackageIgnored,
  loadProjectConfig,
  stripJsonComments,
  stripTrailingCommas,
} from '../../../../src/shared/config/project-config'

describe('project-config', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `inup-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('loadProjectConfig()', () => {
    it('should return empty config when no config file exists', () => {
      const config = loadProjectConfig(testDir)
      expect(config).toEqual({})
    })

    it('should load config from .inuprc', () => {
      const configContent = {
        ignore: ['lodash', 'moment'],
      }
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['lodash', 'moment'])
    })

    it('drops a non-array ignore field', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: 'react' }))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toBeUndefined()
    })

    it('should load config from .inuprc.json', () => {
      const configContent = {
        ignore: ['react', 'react-dom'],
      }
      writeFileSync(join(testDir, '.inuprc.json'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['react', 'react-dom'])
    })

    it('should load config from inup.config.json', () => {
      const configContent = {
        ignore: ['typescript'],
        exclude: ['dist', 'node_modules'],
      }
      writeFileSync(join(testDir, 'inup.config.json'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['typescript'])
      expect(config.exclude).toEqual(['dist', 'node_modules'])
    })

    describe('several config files', () => {
      // Lookup order: the documented inup.config.jsonc first, then the order the older
      // names have always had, which existing projects may rely on.
      const ORDER = ['inup.config.jsonc', '.inuprc', '.inuprc.json', 'inup.config.json']
      const pairs = ORDER.flatMap((winner, i) => ORDER.slice(i + 1).map((loser) => [winner, loser]))

      it('looks the names up in this order', () => {
        expect([...CONFIG_FILES]).toEqual(ORDER)
      })

      it.each(pairs)('%s wins over %s, with one warning naming the other', (winner, loser) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        writeFileSync(join(testDir, winner), JSON.stringify({ ignore: [winner] }))
        writeFileSync(join(testDir, loser), JSON.stringify({ ignore: [loser] }))

        expect(loadProjectConfig(testDir)).toEqual({ ignore: [winner] })
        expect(warn).toHaveBeenCalledExactlyOnceWith(
          `Warning: ${testDir} has several config files; using ${winner}. Delete ${loser} to silence this.`
        )
        warn.mockRestore()
      })

      it('names every file it ignores', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        for (const name of ORDER)
          writeFileSync(join(testDir, name), JSON.stringify({ ignore: [name] }))

        expect(loadProjectConfig(testDir)).toEqual({ ignore: ['inup.config.jsonc'] })
        expect(warn).toHaveBeenCalledExactlyOnceWith(
          `Warning: ${testDir} has several config files; using inup.config.jsonc. Delete .inuprc, .inuprc.json, inup.config.json to silence this.`
        )
        warn.mockRestore()
      })

      it.each(ORDER)('says nothing about a lone %s', (name) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        writeFileSync(join(testDir, name), JSON.stringify({ ignore: ['only-one'] }))

        expect(loadProjectConfig(testDir)).toEqual({ ignore: ['only-one'] })
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
      })

      it('says nothing when the configs are in different directories', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const child = join(testDir, 'child')
        mkdirSync(child)
        writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: ['parent'] }))
        writeFileSync(join(child, 'inup.config.jsonc'), JSON.stringify({ ignore: ['child'] }))

        expect(loadProjectConfig(child)).toEqual({ ignore: ['child'] })
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
      })
    })

    it('loads inup.config.jsonc with comments and trailing commas', () => {
      writeFileSync(
        join(testDir, 'inup.config.jsonc'),
        '// project rules\n{\n  "ignore": ["react"], // pinned\n  "concurrency": 4,\n}\n'
      )

      expect(loadProjectConfig(testDir)).toEqual({ ignore: ['react'], concurrency: 4 })
    })

    describe('findConfigFilesIn()', () => {
      it('lists every config file in the directory, in lookup order', () => {
        writeFileSync(join(testDir, 'inup.config.json'), '{}')
        writeFileSync(join(testDir, 'inup.config.jsonc'), '{}')

        expect(findConfigFilesIn(testDir)).toEqual([
          join(testDir, 'inup.config.jsonc'),
          join(testDir, 'inup.config.json'),
        ])
      })

      it('does not look in parent directories', () => {
        const child = join(testDir, 'child')
        mkdirSync(child)
        writeFileSync(join(testDir, '.inuprc'), '{}')

        expect(findConfigFilesIn(child)).toEqual([])
      })
    })

    it('should search parent directories for config', () => {
      const subDir = join(testDir, 'packages', 'my-package')
      mkdirSync(subDir, { recursive: true })

      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: ['parent-config'] }))

      const config = loadProjectConfig(subDir)
      expect(config.ignore).toEqual(['parent-config'])
    })

    it('parses a config containing line and block comments', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        [
          '// .inuprc — generated by inup v1.0.0',
          '{',
          '  // packages to skip',
          '  "ignore": ["lodash"], /* inline note */',
          '  "exclude": ["dist"]',
          '  // "concurrency": 4',
          '}',
        ].join('\n')
      )

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['lodash'])
      expect(config.exclude).toEqual(['dist'])
      expect(config.concurrency).toBeUndefined()
    })

    it('accepts trailing commas', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        '{\n  "ignore": ["a", "b",],\n  "concurrency": 4, // pinned\n}'
      )

      expect(loadProjectConfig(testDir)).toEqual({ ignore: ['a', 'b'], concurrency: 4 })
    })

    it('refuses invalid JSON, naming the file and the position', () => {
      const configPath = join(testDir, '.inuprc')
      const content =
        '// header\n{\n  "ignore": [], /* note */\n  "exclude": []\n  "scanDirs": []\n}'
      writeFileSync(configPath, content)

      expect(() => loadProjectConfig(testDir)).toThrow(`Invalid config file ${configPath}: `)
      // Stripping blanks rather than deletes, so the position points into the file as written.
      const position = content.indexOf('"scanDirs"')
      expect(() => loadProjectConfig(testDir)).toThrow(new RegExp(`at position ${position}\\b`))
    })

    it('never falls back to a parent config when the nearest one is broken', () => {
      // The broken file may be the one turning the cooldown on; quietly running
      // with the parent's settings instead would leave the user unprotected.
      const child = join(testDir, 'child')
      mkdirSync(child)
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: ['from-parent'] }))
      writeFileSync(join(child, '.inuprc'), '{ "minimumReleaseAge": 10080 "ignore": [] }')

      expect(() => loadProjectConfig(child)).toThrow(join(child, '.inuprc'))
    })

    it('never falls back to a lower-precedence file in the same directory', () => {
      writeFileSync(join(testDir, '.inuprc'), 'not valid json {')
      writeFileSync(join(testDir, '.inuprc.json'), JSON.stringify({ ignore: ['from-json'] }))

      expect(() => loadProjectConfig(testDir)).toThrow(join(testDir, '.inuprc'))
    })

    describe('byte order mark', () => {
      const BOM = '﻿'

      it.each([
        ['plain JSON', `${BOM}{"ignore": ["a"]}`],
        ['comments and a trailing comma', `${BOM}// header\n{\n  "ignore": ["a"], /* note */\n}\n`],
        ['CRLF line endings', `${BOM}// header\r\n{\r\n  "ignore": ["a"],\r\n}\r\n`],
      ])('reads a file that starts with one: %s', (_label, content) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        writeFileSync(join(testDir, '.inuprc'), content)

        expect(loadProjectConfig(testDir)).toEqual({ ignore: ['a'] })
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
      })

      it('keeps error positions pointing into the file as written', () => {
        const content = `${BOM}{\n  "ignore": []\n  "exclude": []\n}`
        writeFileSync(join(testDir, '.inuprc'), content)

        const position = content.indexOf('"exclude"')
        expect(() => loadProjectConfig(testDir)).toThrow(new RegExp(`at position ${position}\\b`))
      })

      it('still refuses one anywhere but the very start', () => {
        writeFileSync(join(testDir, '.inuprc'), `{"ignore": []}${BOM}`)

        expect(() => loadProjectConfig(testDir)).toThrow(
          `Invalid config file ${join(testDir, '.inuprc')}`
        )
      })
    })

    describe('empty file', () => {
      it.each([
        ['zero bytes', ''],
        ['only whitespace', '  \n\r\n\t\n'],
        ['only comments', '// nothing yet\n/* still nothing */\n'],
        ['only a byte order mark', '﻿'],
      ])('reads %s as defaults, with a warning', (_label, content) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const configPath = join(testDir, '.inuprc')
        writeFileSync(configPath, content)

        expect(loadProjectConfig(testDir)).toEqual({})
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith(`Warning: ${configPath} is empty; using defaults`)
        warn.mockRestore()
      })

      it('still counts as the nearest config, so a parent config is not used instead', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const child = join(testDir, 'child')
        mkdirSync(child)
        writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ minimumReleaseAge: 10080 }))
        writeFileSync(join(child, '.inuprc'), '')

        expect(loadProjectConfig(child)).toEqual({})
        warn.mockRestore()
      })
    })

    describe('what counts as a config file being there', () => {
      it.skipIf(process.platform === 'win32')(
        'fails on a dangling symlink instead of quietly using the next file',
        () => {
          symlinkSync(join(testDir, 'missing-target'), join(testDir, '.inuprc'))
          writeFileSync(join(testDir, '.inuprc.json'), JSON.stringify({ ignore: ['from-json'] }))

          expect(() => loadProjectConfig(testDir)).toThrow(
            `Invalid config file ${join(testDir, '.inuprc')}`
          )
        }
      )

      it('fails on a directory with a config file name', () => {
        mkdirSync(join(testDir, '.inuprc'))
        writeFileSync(join(testDir, '.inuprc.json'), JSON.stringify({ ignore: ['from-json'] }))

        expect(() => loadProjectConfig(testDir)).toThrow(
          `Invalid config file ${join(testDir, '.inuprc')}`
        )
      })

      it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
        'keeps searching past a directory it may not look inside, as before',
        () => {
          const locked = join(testDir, 'locked')
          const cwd = join(locked, 'cwd')
          mkdirSync(cwd, { recursive: true })
          writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: ['from-parent'] }))
          chmodSync(locked, 0o000)
          try {
            expect(loadProjectConfig(cwd)).toEqual({ ignore: ['from-parent'] })
          } finally {
            chmodSync(locked, 0o755)
          }
        }
      )
    })

    it.each(['null', '[]', '42'])('refuses a top-level %s instead of an object', (raw) => {
      writeFileSync(join(testDir, '.inuprc'), raw)

      expect(() => loadProjectConfig(testDir)).toThrow('expected a JSON object')
    })

    it('should filter out non-string values in ignore array', () => {
      const configContent = {
        ignore: ['valid', 123, 'also-valid', null, 'still-valid'],
      }
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify(configContent))

      const config = loadProjectConfig(testDir)
      expect(config.ignore).toEqual(['valid', 'also-valid', 'still-valid'])
    })

    it('should load ignoreMajor patterns', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ ignoreMajor: ['@tiptap/*', 'react'] })
      )

      const config = loadProjectConfig(testDir)
      expect(config.ignoreMajor).toEqual(['@tiptap/*', 'react'])
    })

    it('drops a non-array ignoreMajor field and filters non-string entries', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignoreMajor: '@tiptap/*' }))
      expect(loadProjectConfig(testDir).ignoreMajor).toBeUndefined()

      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ ignoreMajor: ['@tiptap/*', 42, null] })
      )
      expect(loadProjectConfig(testDir).ignoreMajor).toEqual(['@tiptap/*'])
    })

    it('loads only patterns, keeping string entries and dropping a non-array value', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ only: ['react', 42, '@myco/*'] }))
      expect(loadProjectConfig(testDir).only).toEqual(['react', '@myco/*'])

      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ only: 'react' }))
      expect(loadProjectConfig(testDir).only).toBeUndefined()
    })

    it('should load showPeerDependencyVulnerabilities when set to a boolean', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ showPeerDependencyVulnerabilities: true })
      )

      const config = loadProjectConfig(testDir)
      expect(config.showPeerDependencyVulnerabilities).toBe(true)
    })

    it('should load showOptionalDependencyVulnerabilities when set to a boolean', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ showOptionalDependencyVulnerabilities: true })
      )

      const config = loadProjectConfig(testDir)
      expect(config.showOptionalDependencyVulnerabilities).toBe(true)
    })

    it('loads minimumReleaseAge and its exclusion list', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({
          minimumReleaseAge: 10080,
          minimumReleaseAgeExclude: ['@myco/*', 42, 'internal-tool', null],
        })
      )

      const config = loadProjectConfig(testDir)
      expect(config.minimumReleaseAge).toBe(10080)
      // Non-string entries are filtered, like the ignore list.
      expect(config.minimumReleaseAgeExclude).toEqual(['@myco/*', 'internal-tool'])
    })

    it('accepts minimumReleaseAge of 0 (explicitly disabled)', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ minimumReleaseAge: 0 }))

      expect(loadProjectConfig(testDir).minimumReleaseAge).toBe(0)
    })

    it('drops invalid minimumReleaseAge values', () => {
      for (const bad of [-5, '10080', null]) {
        writeFileSync(join(testDir, '.inuprc'), `{"minimumReleaseAge": ${JSON.stringify(bad)}}`)
        expect(loadProjectConfig(testDir).minimumReleaseAge).toBeUndefined()
      }
    })

    it('drops a non-array minimumReleaseAgeExclude', () => {
      writeFileSync(
        join(testDir, '.inuprc'),
        JSON.stringify({ minimumReleaseAgeExclude: 'not-an-array' })
      )

      expect(loadProjectConfig(testDir).minimumReleaseAgeExclude).toBeUndefined()
    })
  })

  describe('native field', () => {
    it.each([true, false])('loads native: %s', (native) => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ native }))
      expect(loadProjectConfig(testDir).native).toBe(native)
    })

    it.each(['yes', 1, null])('ignores a non-boolean native value (%s)', (native) => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ native }))
      expect(loadProjectConfig(testDir).native).toBeUndefined()
    })
  })

  describe('verify field', () => {
    it('loads the command', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ verify: 'pnpm test --run' }))
      expect(loadProjectConfig(testDir).verify).toBe('pnpm test --run')
    })

    it.each([
      ['empty', '""'],
      ['blank', '"  "'],
      ['a boolean', 'true'],
      ['a list', '["npm test"]'],
    ])('drops a verify value that is %s and says so', (_label, raw) => {
      // Dropped silently, the upgrades would go in without the check the user asked for.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(testDir, '.inuprc'), `{"verify": ${raw}}`)
      expect(loadProjectConfig(testDir).verify).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"verify"'))
      warn.mockRestore()
    })
  })

  describe('concurrency field', () => {
    it('accepts an integer concurrency within the pool range', () => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ concurrency: 8 }))
      expect(loadProjectConfig(testDir).concurrency).toBe(8)
    })

    it.each([
      ['"8"', '"8"'],
      ['zero', '0'],
      ['negative', '-3'],
      ['above pool', '99'],
      ['fractional', '7.5'],
    ])('drops an invalid concurrency value (%s) and says so', (_label, raw) => {
      // Silent dropping would invert the user's intent: they pinned a low limit
      // to protect a slow/metered link, and the run would adapt up to 24.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(testDir, '.inuprc'), `{"concurrency": ${raw}}`)
      expect(loadProjectConfig(testDir).concurrency).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('concurrency'))
      warn.mockRestore()
    })

    it('does not warn when concurrency is valid or absent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ concurrency: 8 }))
      loadProjectConfig(testDir)
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ ignore: [] }))
      loadProjectConfig(testDir)
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('unknown keys', () => {
    let warn: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warn.mockRestore()
    })

    it.each([
      ['minimumReleaseAg', 'minimumReleaseAge'],
      ['minimum-release-age', 'minimumReleaseAge'],
      ['concurency', 'concurrency'],
      ['Native', 'native'],
    ])('warns about "%s", naming the file and suggesting "%s"', (key, suggestion) => {
      // A typo'd key must not read as "setting not configured" without a word.
      const configPath = join(testDir, '.inuprc')
      writeFileSync(configPath, JSON.stringify({ [key]: 1, ignore: ['kept'] }))

      expect(loadProjectConfig(testDir)).toEqual({ ignore: ['kept'] })
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Warning: ignoring unknown key "${key}" in ${configPath} (did you mean "${suggestion}"?)`
      )
    })

    it.each([
      ['a URL', 'https://cdn.jsdelivr.net/npm/inup@1/config-schema.json'],
      ['a relative path', './node_modules/inup/config-schema.json'],
      ['a number', 42],
    ])('accepts "$schema" set to %s silently, and leaves it out of the config', (_label, value) => {
      writeFileSync(join(testDir, '.inuprc'), JSON.stringify({ $schema: value, ignore: ['kept'] }))

      expect(loadProjectConfig(testDir)).toEqual({ ignore: ['kept'] })
      expect(warn).not.toHaveBeenCalled()
    })

    it('suggests "$schema" for "schema"', () => {
      const configPath = join(testDir, '.inuprc')
      writeFileSync(configPath, JSON.stringify({ schema: 'x' }))

      loadProjectConfig(testDir)
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Warning: ignoring unknown key "schema" in ${configPath} (did you mean "$schema"?)`
      )
    })

    it('warns without a suggestion when no known key is close', () => {
      const configPath = join(testDir, '.inuprc')
      writeFileSync(configPath, JSON.stringify({ theme: 'dark' }))

      loadProjectConfig(testDir)
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Warning: ignoring unknown key "theme" in ${configPath}`
      )
    })
  })

  describe('isPackageIgnored()', () => {
    it('should match exact package names', () => {
      expect(isPackageIgnored('lodash', ['lodash'])).toBe(true)
      expect(isPackageIgnored('lodash', ['moment'])).toBe(false)
    })

    it('should match wildcard patterns with *', () => {
      expect(isPackageIgnored('@babel/core', ['@babel/*'])).toBe(true)
      expect(isPackageIgnored('@babel/preset-env', ['@babel/*'])).toBe(true)
      expect(isPackageIgnored('@types/node', ['@babel/*'])).toBe(false)
    })

    it('should match prefix patterns', () => {
      expect(isPackageIgnored('eslint-plugin-react', ['eslint-*'])).toBe(true)
      expect(isPackageIgnored('eslint-config-prettier', ['eslint-*'])).toBe(true)
      expect(isPackageIgnored('prettier', ['eslint-*'])).toBe(false)
    })

    it('should match suffix patterns', () => {
      expect(isPackageIgnored('react-dom', ['*-dom'])).toBe(true)
      expect(isPackageIgnored('preact-dom', ['*-dom'])).toBe(true)
      expect(isPackageIgnored('react', ['*-dom'])).toBe(false)
    })

    it('should match single character wildcard with ?', () => {
      expect(isPackageIgnored('lodash', ['lodas?'])).toBe(true)
      expect(isPackageIgnored('lodash', ['lod???'])).toBe(true)
      expect(isPackageIgnored('lodash', ['lod??'])).toBe(false)
    })

    it('should match multiple patterns', () => {
      const patterns = ['lodash', '@babel/*', 'eslint-*']
      expect(isPackageIgnored('lodash', patterns)).toBe(true)
      expect(isPackageIgnored('@babel/core', patterns)).toBe(true)
      expect(isPackageIgnored('eslint-plugin-react', patterns)).toBe(true)
      expect(isPackageIgnored('react', patterns)).toBe(false)
    })

    it('should return false for empty patterns array', () => {
      expect(isPackageIgnored('lodash', [])).toBe(false)
    })

    it('should handle scoped packages correctly', () => {
      expect(isPackageIgnored('@types/node', ['@types/*'])).toBe(true)
      expect(isPackageIgnored('@types/react', ['@types/react'])).toBe(true)
      expect(isPackageIgnored('@types/react-dom', ['@types/react'])).toBe(false)
      expect(isPackageIgnored('@types/react-dom', ['@types/react*'])).toBe(true)
    })

    it('should escape special regex characters in patterns', () => {
      // The dot in package names should be treated literally
      expect(isPackageIgnored('socket.io', ['socket.io'])).toBe(true)
      expect(isPackageIgnored('socketXio', ['socket.io'])).toBe(false)
    })
  })
})

describe('stripJsonComments()', () => {
  it('strips line comments to end of line', () => {
    expect(JSON.parse(stripJsonComments('{"a": 1 // note\n}'))).toEqual({ a: 1 })
  })

  it('strips block comments, including multi-line ones', () => {
    expect(JSON.parse(stripJsonComments('{/* x */"a": /* y\nz */ 1}'))).toEqual({ a: 1 })
  })

  it('leaves comment-like sequences inside strings untouched', () => {
    const input = '{"url": "https://example.com/path", "glob": "a/*"}'
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      url: 'https://example.com/path',
      glob: 'a/*',
    })
  })

  it('handles escaped quotes inside strings', () => {
    expect(JSON.parse(stripJsonComments('{"a": "say \\"hi\\" // not a comment"}'))).toEqual({
      a: 'say "hi" // not a comment',
    })
  })

  it('does not crash on a truncated file ending in a string escape', () => {
    // Malformed input (unterminated string, dangling backslash at EOF): the
    // stripper must pass it through untouched and let JSON.parse report it.
    expect(stripJsonComments('{"a": "b\\')).toBe('{"a": "b\\')
  })

  it('preserves line numbers by blanking instead of deleting', () => {
    const stripped = stripJsonComments('// one\n// two\n{}')
    expect(stripped.split('\n')).toHaveLength(3)
    expect(JSON.parse(stripped)).toEqual({})
  })
})

describe('stripTrailingCommas()', () => {
  it('blanks commas that close an object or array, across whitespace and newlines', () => {
    expect(stripTrailingCommas('{"a": [1, 2,\n],\n}')).toBe('{"a": [1, 2 \n] \n}')
  })

  it('leaves commas inside strings untouched, including after escaped quotes', () => {
    const input = '{"a": ", }", "b": "\\", ]"}'
    expect(stripTrailingCommas(input)).toBe(input)
  })

  it('does not crash on a truncated file ending in a string escape', () => {
    expect(stripTrailingCommas('{"a": "b\\')).toBe('{"a": "b\\')
  })
})

describe('config normalization of list fields', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `inup-test-normalize-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('keeps only string entries in exclude and scanDirs', () => {
    writeFileSync(
      join(testDir, '.inuprc'),
      JSON.stringify({
        exclude: ['dist', 42, null, 'coverage'],
        scanDirs: ['packages', false, 'apps'],
      })
    )

    const config = loadProjectConfig(testDir)

    expect(config.exclude).toEqual(['dist', 'coverage'])
    expect(config.scanDirs).toEqual(['packages', 'apps'])
  })

  it('drops non-array exclude and scanDirs values', () => {
    writeFileSync(
      join(testDir, '.inuprc'),
      JSON.stringify({ exclude: 'dist', scanDirs: { nope: true } })
    )

    const config = loadProjectConfig(testDir)

    expect(config.exclude).toBeUndefined()
    expect(config.scanDirs).toBeUndefined()
  })
})
