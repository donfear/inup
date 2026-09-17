import { describe, expect, it } from 'vitest'
import {
  distTagFor,
  findAddons,
  platformManifest,
  platformOf,
  TARGET_ABIS,
} from '../../../scripts/publish-native.mjs'
import { nativePackageName } from '../../../src/shared/registry/native-download'
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
