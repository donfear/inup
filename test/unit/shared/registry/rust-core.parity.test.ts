import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  activeCore,
  detectHost,
  nativeAbi,
  packumentDecoder,
  setRustCoreEnvironment,
} from '../../../../src/shared/registry/rust-core'
import { parseVersions } from '../../../../src/shared/versions'

// The real addon from `pnpm native:build`, loaded through inup's own loader,
// against parseVersions and writeEtag. Skipped where the addon is not built;
// CI sets INUP_PARITY_REQUIRED=1 after placing it, so a missing build fails.
const abi = nativeAbi(detectHost())
const devBuild = abi
  ? join(__dirname, '..', '..', '..', '..', 'native', 'out', `inup.${abi}.node`)
  : null
const built = devBuild !== null && existsSync(devBuild)
const required = process.env.INUP_PARITY_REQUIRED === '1'
const testRequire = createRequire(__filename)

const packuments: Record<string, unknown> = {
  typical: {
    name: 'x',
    'dist-tags': { latest: '1.10.0' },
    versions: {
      '1.0.0': {},
      '1.2.0': {},
      '1.10.0': { deprecated: 'use y', engines: { node: '>=18' } },
      '2.0.0-beta.1': {},
      '2.0.0-beta.10': {},
      '2.0.0-alpha': {},
      '1.0.0+build.1': {},
      'not-a-version': {},
    },
  },
  prereleaseOnly: { versions: { '1.0.0-rc.1': {}, '1.0.0-rc.2': { deprecated: true } } },
  semverEdges: {
    versions: {
      'v2.0.0-beta': {},
      '2.0.0-x.7.z.92': {},
      '2.0.0-x.7.z.10': {},
      '1.0.0-alpha.beta': {},
      '1.0.0-01': {},
      '1.0.0-0a': {},
      '1.0.0-a..b': {},
      ' 3.0.0-a ': {},
      '1.0.0': { deprecated: '   ', engines: { node: String.fromCharCode(0xa0) } },
    },
  },
  unicode: {
    versions: {
      '1.2.3': { deprecated: `use "y" ${String.fromCodePoint(0x2028, 0x1f600, 0x1)}` },
    },
  },
  noVersions: { name: 'x' },
  nullVersions: { versions: null },
  arrayVersions: { versions: [1, 2] },
}

const encodings: Record<string, (body: Buffer) => Buffer> = {
  '': (body) => body,
  gzip: (body) => gzipSync(body),
  deflate: (body) => deflateSync(body),
  br: (body) => brotliCompressSync(body),
}

const tmp = mkdtempSync(join(tmpdir(), 'inup-rust-parity-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe.skipIf(!built && !required)('native core parity', () => {
  afterAll(() => setRustCoreEnvironment(null))

  const decoder = () => {
    // Skip any installed inup-<abi> package so the fresh local build is tested.
    setRustCoreEnvironment({ load: (id) => (id.startsWith('inup-') ? null : testRequire(id)) })
    expect(activeCore()).toBe('native')
    const decode = packumentDecoder()
    if (!decode) throw new Error('native core failed to load')
    return decode
  }

  for (const [name, doc] of Object.entries(packuments)) {
    it(`matches parseVersions and writeEtag for ${name}`, async () => {
      const body = Buffer.from(JSON.stringify(doc))
      const expected = parseVersions(body.toString('utf8'))
      for (const [encoding, compress] of Object.entries(encodings)) {
        const cacheFile = join(tmp, `${name}-${encoding || 'identity'}.json`)
        const etag = `W/"${name}\\"${encoding}"`
        const result = await decoder()({
          raw: compress(body),
          encoding,
          cache: { file: cacheFile, etag },
        })
        expect(result).toEqual(expected)
        expect(readFileSync(cacheFile, 'utf8')).toBe(JSON.stringify({ etag, data: expected }))
      }
    })
  }

  it('rejects bodies the TypeScript decoder would reject', async () => {
    await expect(
      decoder()({ raw: Buffer.from('{"versions":'), encoding: '', cache: null })
    ).rejects.toThrow()
    await expect(
      decoder()({ raw: Buffer.from('not brotli'), encoding: 'br', cache: null })
    ).rejects.toThrow()
  })
})
