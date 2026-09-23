import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  distTagFor,
  findAddons,
  integrityOf,
  PIN_FILE,
  pinSource,
  platformManifest,
  platformOf,
  TARGET_ABIS,
  unpinned,
} from '../../../scripts/publish-native.mjs'
import { nativePackageName, sha512Integrity } from '../../../src/shared/registry/native-download'
import { NATIVE_INTEGRITY } from '../../../src/shared/registry/native-integrity'
import { detectHost, nativeAbi } from '../../../src/shared/registry/rust-core'

describe('TARGET_ABIS', () => {
  it('covers exactly the platforms the loader can request', () => {
    const hosts = [
      ['darwin', 'arm64', false],
      ['darwin', 'x64', false],
      ['linux', 'arm64', false],
      ['linux', 'arm64', true],
      ['linux', 'x64', false],
      ['linux', 'x64', true],
      ['win32', 'arm64', false],
      ['win32', 'x64', false],
    ] as const
    const requested = hosts.map(([platform, arch, isMusl]) => nativeAbi({ platform, arch, isMusl }))
    expect([...TARGET_ABIS].sort()).toEqual([...requested].sort())
    expect(TARGET_ABIS).toContain(nativeAbi(detectHost()) ?? TARGET_ABIS[0])
  })

  it('matches the napi.targets built by CI', async () => {
    const { default: pkg } = await import('../../../package.json')
    expect(pkg.napi.targets).toHaveLength(TARGET_ABIS.length)
  })
})

describe('distTagFor', () => {
  it('publishes prereleases under next and releases under latest', () => {
    expect(distTagFor('1.8.0')).toBe('latest')
    expect(distTagFor('1.8.0-rc.0')).toBe('next')
  })
})

describe('platformOf', () => {
  it.each([
    ['darwin-arm64', { os: ['darwin'], cpu: ['arm64'] }],
    ['linux-x64-gnu', { os: ['linux'], cpu: ['x64'], libc: ['glibc'] }],
    ['linux-arm64-musl', { os: ['linux'], cpu: ['arm64'], libc: ['musl'] }],
    ['win32-x64-msvc', { os: ['win32'], cpu: ['x64'] }],
  ])('%s → %o', (abi, expected) => {
    expect(platformOf(abi)).toEqual(expected)
  })
})

describe('platformManifest', () => {
  it('describes one addon file under its npm package name', () => {
    const repository = { type: 'git', url: 'git+https://github.com/donfear/inup.git' }
    const manifest = platformManifest({
      abi: 'win32-x64-msvc',
      version: '1.8.0',
      name: nativePackageName('win32-x64-msvc'),
      repository,
    })
    expect(manifest).toMatchObject({
      name: 'inup-windows-x64',
      version: '1.8.0',
      license: 'MIT',
      repository,
      os: ['win32'],
      cpu: ['x64'],
      main: 'inup.win32-x64-msvc.node',
      files: ['inup.win32-x64-msvc.node'],
    })
    expect(manifest).not.toHaveProperty('libc')
  })
})

describe('findAddons', () => {
  it('finds every target addon wherever the artifacts put it', () => {
    const paths = TARGET_ABIS.map((abi) => `artifacts/bindings-${abi}/inup.${abi}.node`)
    const { found, missing } = findAddons([...paths, 'artifacts/other/readme.txt'])
    expect(missing).toEqual([])
    expect(found.get('linux-x64-musl')).toBe(
      'artifacts/bindings-linux-x64-musl/inup.linux-x64-musl.node'
    )
  })

  it('reports missing targets', () => {
    const { missing } = findAddons(['a/inup.darwin-arm64.node'])
    expect(missing).toEqual(TARGET_ABIS.filter((abi) => abi !== 'darwin-arm64'))
  })
})

describe('pinned native core hashes', () => {
  const addons = Object.fromEntries(TARGET_ABIS.map((abi) => [abi, Buffer.from(`addon ${abi}`)]))
  const pins = Object.fromEntries(TARGET_ABIS.map((abi) => [abi, integrityOf(addons[abi])]))

  it('hashes addons the way inup checks them', () => {
    for (const abi of TARGET_ABIS) {
      expect(integrityOf(addons[abi])).toBe(sha512Integrity(addons[abi]))
    }
  })

  it('generates a native-integrity module inup can read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inup-pins-'))
    try {
      const file = join(dir, 'native-integrity.ts')
      writeFileSync(file, pinSource(pins))
      // A file:// URL, as Vite's module runner resolves it the same way on Windows.
      const generated = await import(pathToFileURL(file).href)
      expect(generated.NATIVE_INTEGRITY).toEqual(pins)
      expect(unpinned(generated.NATIVE_INTEGRITY)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports every target without a well-formed pin', () => {
    const { 'linux-x64-musl': _, ...partial } = pins
    expect(unpinned({ ...partial, 'darwin-x64': 'sha512-short' })).toEqual([
      'darwin-x64',
      'linux-x64-musl',
    ])
    expect(unpinned(undefined)).toEqual(TARGET_ABIS)
  })

  it('pins nothing in the repository: only a release fills it in', () => {
    expect(PIN_FILE).toBe('src/shared/registry/native-integrity.ts')
    expect(NATIVE_INTEGRITY).toEqual({})
  })
})
