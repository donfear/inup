import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debugLog } from '../../../../src/shared/debug-logger'
import { nativeCoreFile, sha512Integrity } from '../../../../src/shared/registry/native-download'
import {
  activeCore,
  CORE_ABI_VERSION,
  configureNativeCore,
  detectHost,
  followingRequestId,
  type HostInfo,
  nativeAbi,
  nativeCoreDownload,
  nativeTransport,
  type PackumentDecodeRequest,
  packumentDecoder,
  setRustCoreEnvironment,
} from '../../../../src/shared/registry/rust-core'

const raw = Buffer.from('body')
const parsed = {
  latestVersion: '2.0.0',
  allVersions: ['2.0.0', '1.0.0'],
  prereleaseVersions: ['2.0.0-rc.1'],
}

const request = (cache: PackumentDecodeRequest['cache'] = null): PackumentDecodeRequest => ({
  raw,
  encoding: 'br',
  cache,
})

const MAC: HostInfo = { platform: 'darwin', arch: 'arm64', isMusl: false }

const fakeAddon = (overrides: Record<string, unknown> = {}) => ({
  abiVersion: () => CORE_ABI_VERSION,
  decodePackument: vi.fn(async () => ({ ...parsed, deprecated: null, enginesNode: '>=20' })),
  ...overrides,
})

const DEV_BUILD = /native[/\\]out[/\\]inup\.darwin-arm64\.node$/

/** The addon released with this (pretend) inup, and its pinned hash. */
const RELEASED = Buffer.from('released addon bytes')
const PINS = { 'darwin-arm64': sha512Integrity(RELEASED) }

let cacheRoot = ''
const cachedFile = () => nativeCoreFile(cacheRoot, '9.9.9', 'darwin-arm64')

/** Put `content` where an earlier run's download would have cached the addon. */
const cacheAddon = (content: Buffer | string = RELEASED) => {
  mkdirSync(dirname(cachedFile()), { recursive: true })
  writeFileSync(cachedFile(), content)
}

/** Opt in and load addons through `load`, with a stubbed download. */
const useAddon = (
  load: (id: string) => unknown,
  download = vi.fn(async (_options: unknown) => cachedFile()),
  pins: Record<string, string> = PINS
) => {
  configureNativeCore({ enabled: true })
  setRustCoreEnvironment({ host: MAC, load, cacheRoot, version: '9.9.9', download, pins })
  return download
}

/** Loads fail for the dev build and succeed for anything else. */
const cachedOnly = () =>
  vi.fn((id: string) => {
    if (DEV_BUILD.test(id)) throw new Error('Cannot find module')
    return fakeAddon()
  })

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'inup-rust-core-'))
})

afterEach(() => {
  configureNativeCore({ enabled: false })
  setRustCoreEnvironment(null)
  vi.restoreAllMocks()
  rmSync(cacheRoot, { recursive: true, force: true })
})

describe('nativeAbi', () => {
  it.each([
    ['darwin', 'arm64', false, 'darwin-arm64'],
    ['darwin', 'x64', false, 'darwin-x64'],
    ['win32', 'x64', false, 'win32-x64-msvc'],
    ['win32', 'arm64', false, 'win32-arm64-msvc'],
    ['linux', 'x64', false, 'linux-x64-gnu'],
    ['linux', 'arm64', false, 'linux-arm64-gnu'],
    ['linux', 'x64', true, 'linux-x64-musl'],
    ['linux', 'arm64', true, 'linux-arm64-musl'],
  ] as const)('%s/%s musl=%s → %s', (platform, arch, isMusl, abi) => {
    expect(nativeAbi({ platform, arch, isMusl })).toBe(abi)
  })

  it.each([
    ['freebsd', 'x64'],
    ['linux', 'ia32'],
    ['win32', 'ia32'],
    ['darwin', 'ppc64'],
    ['android', 'arm64'],
  ] as const)('has no prebuilt addon for %s/%s', (platform, arch) => {
    expect(nativeAbi({ platform, arch, isMusl: false })).toBeNull()
  })
})

describe('detectHost', () => {
  it('defaults to the running process', () => {
    const host = detectHost()
    expect(host.platform).toBe(process.platform)
    expect(host.arch).toBe(process.arch)
  })

  it('treats Linux without a glibc runtime version as musl', () => {
    const linux = (report: unknown) => detectHost({ platform: 'linux', getReport: () => report })
    expect(linux({ header: { glibcVersionRuntime: '2.39' } }).isMusl).toBe(false)
    expect(linux({ header: {} }).isMusl).toBe(true)
    expect(linux(undefined).isMusl).toBe(true)
  })

  it('reads the real process report on Linux', () => {
    // Runs the default report reader on every OS (process.report exists
    // everywhere), so coverage does not depend on the machine running it.
    const host = detectHost({ platform: 'linux', arch: 'x64' })
    expect(typeof host.isMusl).toBe('boolean')
    expect(process.report.excludeNetwork).toBe(true)
  })

  it('never inspects libc outside Linux', () => {
    const getReport = vi.fn()
    expect(detectHost({ platform: 'darwin', getReport }).isMusl).toBe(false)
    expect(getReport).not.toHaveBeenCalled()
  })
})

describe('core selection', () => {
  it('is off by default and never loads or downloads anything', () => {
    const load = vi.fn()
    const download = vi.fn()
    setRustCoreEnvironment({ host: MAC, load, download })
    expect(activeCore()).toBe('js')
    expect(nativeTransport()).toBeNull()
    expect(load).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(nativeCoreDownload()).toBeNull()
  })

  it('prefers a local dev build when opted in', () => {
    const load = vi.fn((_id: string) => fakeAddon())
    const download = useAddon(load)
    expect(activeCore()).toBe('native')
    expect(load.mock.calls.map(([id]) => id)).toEqual([expect.stringMatching(DEV_BUILD)])
    expect(download).not.toHaveBeenCalled()
  })

  it('uses the addon cached by an earlier run once it matches the pinned hash', () => {
    cacheAddon()
    const load = cachedOnly()
    const download = useAddon(load)
    expect(activeCore()).toBe('native')
    expect(load.mock.calls[1][0]).toBe(cachedFile())
    expect(download).not.toHaveBeenCalled()
  })

  it('deletes and never loads a cached addon that does not match the pinned hash', async () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    cacheAddon('swapped by another process')
    const load = cachedOnly()
    const download = useAddon(load)

    expect(activeCore()).toBe('js')
    expect(load.mock.calls.map(([id]) => id)).toEqual([expect.stringMatching(DEV_BUILD)])
    expect(existsSync(cachedFile())).toBe(false)
    const skipped = info.mock.calls.find(([, message]) =>
      String(message).startsWith('native core not available')
    )
    expect(skipped?.[2]).toContainEqual(
      `${cachedFile()}: does not match the native core released with this inup; deleted`
    )
    // A fresh, verified copy replaces it for the next run.
    await nativeCoreDownload()
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ integrity: PINS['darwin-arm64'] })
    )
  })

  it('neither loads a cached addon nor downloads one when this build pins none', () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    cacheAddon()
    const load = cachedOnly()
    const download = useAddon(load, undefined, {})

    expect(activeCore()).toBe('js')
    expect(load).toHaveBeenCalledTimes(1)
    expect(download).not.toHaveBeenCalled()
    expect(nativeCoreDownload()).toBeNull()
    // Not ours to judge: another inup of the same version may have pinned it.
    expect(readFileSync(cachedFile())).toEqual(RELEASED)
    expect(info).toHaveBeenCalledWith(
      'rust-core',
      'this inup build pins no native core for darwin-arm64'
    )
  })

  it('downloads in the background when nothing is available, staying on TypeScript this run', async () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    const download = useAddon(() => {
      throw new Error('Cannot find module')
    })

    expect(activeCore()).toBe('js')
    expect(packumentDecoder()).toBeNull()
    await nativeCoreDownload()

    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith({
      cacheRoot,
      version: '9.9.9',
      abi: 'darwin-arm64',
      integrity: PINS['darwin-arm64'],
    })
    expect(info).toHaveBeenCalledWith(
      'rust-core',
      `native core downloaded to ${cachedFile()}; used from the next run`
    )
  })

  it('stays on TypeScript without downloading when downloads are disallowed', () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    const download = useAddon(() => null)
    configureNativeCore({ enabled: true, download: false })
    expect(activeCore()).toBe('js')
    expect(download).not.toHaveBeenCalled()
    expect(nativeCoreDownload()).toBeNull()
    expect(info).toHaveBeenCalledWith('rust-core', 'native core download skipped for this run')
  })

  it('still loads a cached addon when downloads are disallowed', () => {
    const download = useAddon(() => fakeAddon())
    configureNativeCore({ enabled: true, download: false })
    expect(activeCore()).toBe('native')
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads at most once per process', () => {
    const download = useAddon(() => null)
    activeCore()
    configureNativeCore({ enabled: true })
    activeCore()
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('stays on TypeScript with a warning when the download fails', async () => {
    const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
    useAddon(
      () => null,
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    expect(activeCore()).toBe('js')
    await expect(nativeCoreDownload()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'rust-core',
      'native core download failed, staying on TypeScript',
      expect.any(Error)
    )
  })

  it.each([
    [
      'it cannot be loaded',
      () => {
        throw new Error('dlopen: wrong architecture')
      },
    ],
    ['it throws something other than an Error', () => throwString()],
    ['it is from another ABI', () => fakeAddon({ abiVersion: () => 2 })],
    ['it predates abiVersion', () => ({ decodePackument: async () => parsed })],
    ['its decodePackument export is missing', () => fakeAddon({ decodePackument: undefined })],
    ['the module is empty', () => null],
  ])('skips an addon when %s', (_label, load) => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    cacheAddon()
    useAddon(load)
    expect(activeCore()).toBe('js')
    const skipped = info.mock.calls.find(([, message]) =>
      String(message).startsWith('native core not available')
    )
    expect(skipped?.[2]).toHaveLength(2)
  })

  it('never loads anything on hosts without a prebuilt addon', () => {
    const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
    const load = vi.fn()
    configureNativeCore({ enabled: true })
    setRustCoreEnvironment({ host: { platform: 'freebsd', arch: 'x64', isMusl: false }, load })
    expect(activeCore()).toBe('js')
    expect(load).not.toHaveBeenCalled()
    expect(nativeCoreDownload()).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('resolves once per process and logs the choice', () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    const load = vi.fn((_id: string) => fakeAddon())
    useAddon(load)
    const first = packumentDecoder()
    expect(packumentDecoder()).toBe(first)
    expect(activeCore()).toBe('native')
    expect(load).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      'rust-core',
      'native core enabled; registry decoder: native, transport: js'
    )
  })

  it('uses real host detection, require, cache paths and pins by default', () => {
    vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
    const download = vi.fn(async () => '/unused')
    configureNativeCore({ enabled: true })
    setRustCoreEnvironment({ download })
    // A dev checkout may have native/out built, CI does not: both must resolve cleanly.
    expect(['native', 'js']).toContain(activeCore())
    // Source builds pin no native core, so they never download one.
    expect(download).not.toHaveBeenCalled()
  })
})

describe('native decoder', () => {
  const decoderWith = (decodePackument: (...args: unknown[]) => Promise<unknown>) => {
    useAddon(() => fakeAddon({ decodePackument }))
    const decoder = packumentDecoder()
    if (!decoder) throw new Error('expected the native decoder')
    return decoder
  }

  it('passes the cache target through and maps Rust None (null) to undefined', async () => {
    const decode = vi.fn(async () => ({ ...parsed, deprecated: null, enginesNode: '>=20' }))
    const decoder = decoderWith(decode)

    const result = await decoder(request({ file: '/cache/entry.json', etag: 'W/"1"' }))
    expect(decode).toHaveBeenCalledWith(raw, 'br', '/cache/entry.json', 'W/"1"')
    expect(result).toEqual({ ...parsed, deprecated: undefined, enginesNode: '>=20' })
    expect(Object.keys(result)).toEqual([
      'latestVersion',
      'allVersions',
      'prereleaseVersions',
      'deprecated',
      'enginesNode',
    ])

    await decoder(request())
    expect(decode).toHaveBeenLastCalledWith(raw, 'br', null, null)
  })

  it('keeps present health signals and drops absent ones', async () => {
    const decoder = decoderWith(async () => ({
      ...parsed,
      deprecated: 'use 3.x',
      enginesNode: null,
    }))
    expect(await decoder(request())).toEqual({
      ...parsed,
      deprecated: 'use 3.x',
      enginesNode: undefined,
    })
  })

  it('propagates decode failures to the caller', async () => {
    const decoder = decoderWith(async () => {
      throw new Error('invalid packument JSON')
    })
    await expect(decoder(request())).rejects.toThrow('invalid packument JSON')
  })
})

function throwString(): never {
  throw 'not an Error object'
}

describe('native transport', () => {
  const transportAddon = (overrides: Record<string, unknown> = {}) =>
    fakeAddon({
      fetchPackument: vi.fn(async (request: { requestId: number }) => ({
        kind: 'success',
        requestId: request.requestId,
      })),
      cancelFetch: vi.fn(),
      takeReceivedBytes: vi.fn(() => 512),
      ...overrides,
    })

  const transportWith = (addon: ReturnType<typeof transportAddon>) => {
    useAddon(() => addon)
    const transport = nativeTransport()
    if (!transport) throw new Error('expected the native transport')
    return transport
  }

  it('is available only when the addon exports the whole transport', () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    useAddon(() => transportAddon())
    expect(nativeTransport()).not.toBeNull()
    expect(info).toHaveBeenCalledWith(
      'rust-core',
      'native core enabled; registry decoder: native, transport: native'
    )

    for (const missing of ['fetchPackument', 'cancelFetch', 'takeReceivedBytes']) {
      useAddon(() => transportAddon({ [missing]: undefined }))
      expect(nativeTransport()).toBeNull()
      expect(activeCore()).toBe('native')
    }

    useAddon(() => transportAddon())
    configureNativeCore({ enabled: false })
    expect(nativeTransport()).toBeNull()
  })

  it('forwards the request with a fresh id and passes byte counts through', async () => {
    const addon = transportAddon()
    const transport = transportWith(addon)
    const request = { url: 'https://registry.npmjs.org/a', cacheFile: null }

    await transport.fetch(request)
    await transport.fetch(request)

    const ids = addon.fetchPackument.mock.calls.map(([r]) => r.requestId)
    expect(ids[1]).toBe(ids[0] + 1)
    // Null fields are left out: napi maps absent fields to None but rejects null.
    expect(addon.fetchPackument.mock.calls[0][0]).toEqual({ url: request.url, requestId: ids[0] })

    await transport.fetch({
      url: 'https://registry.npmjs.org/b',
      authorization: 'Bearer t',
      cacheFile: '/cache/b.json',
      headersTimeoutMs: 100,
    })
    expect(addon.fetchPackument.mock.calls[2][0]).toEqual({
      url: 'https://registry.npmjs.org/b',
      requestId: ids[1] + 1,
      authorization: 'Bearer t',
      cacheFile: '/cache/b.json',
      headersTimeoutMs: 100,
    })
    expect(transport.takeReceivedBytes()).toBe(512)
  })

  it('cancels the native request when the signal aborts, then stops listening', async () => {
    let finish: (value: unknown) => void = () => {}
    const addon = transportAddon({
      fetchPackument: vi.fn(
        (request: { requestId: number }) =>
          new Promise((resolve) => {
            finish = () => resolve({ kind: 'cancelled', requestId: request.requestId })
          })
      ),
    })
    const transport = transportWith(addon)
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = transport.fetch({ url: 'u', cacheFile: null }, controller.signal)
    controller.abort()
    finish(undefined)
    await pending

    const id = addon.fetchPackument.mock.calls[0][0].requestId
    expect(addon.cancelFetch).toHaveBeenCalledWith(id)
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('cancels immediately when the signal is already aborted', async () => {
    const addon = transportAddon()
    const transport = transportWith(addon)
    await transport.fetch({ url: 'u', cacheFile: null }, AbortSignal.abort())
    expect(addon.cancelFetch).toHaveBeenCalledTimes(1)
  })

  it('does not cancel requests that finish normally', async () => {
    const addon = transportAddon()
    const transport = transportWith(addon)
    await transport.fetch({ url: 'u', cacheFile: null }, new AbortController().signal)
    expect(addon.cancelFetch).not.toHaveBeenCalled()
  })

  it('wraps request ids before they leave the u32 range', () => {
    expect(followingRequestId(1)).toBe(2)
    expect(followingRequestId(0xffff_fffd)).toBe(0xffff_fffe)
    expect(followingRequestId(0xffff_fffe)).toBe(1)
  })
})
