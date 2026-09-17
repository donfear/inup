import { afterEach, describe, expect, it, vi } from 'vitest'
import { debugLog } from '../../../../src/shared/debug-logger'
import {
  activeCore,
  CORE_ABI_VERSION,
  detectHost,
  followingRequestId,
  type HostInfo,
  nativeAbi,
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

const originalCore = process.env.INUP_CORE

afterEach(() => {
  setRustCoreEnvironment(null)
  if (originalCore === undefined) delete process.env.INUP_CORE
  else process.env.INUP_CORE = originalCore
  vi.restoreAllMocks()
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
  it('prefers the installed platform package', () => {
    const load = vi.fn((_id: string) => fakeAddon())
    setRustCoreEnvironment({ host: MAC, load })
    expect(activeCore()).toBe('native')
    expect(packumentDecoder()).not.toBeNull()
    expect(load.mock.calls.map(([id]) => id)).toEqual(['inup-darwin-arm64'])
  })

  it('falls back to a local dev build when the package is not installed', () => {
    const load = vi.fn((id: string) => {
      if (id === 'inup-darwin-arm64') throw new Error("Cannot find module 'inup-darwin-arm64'")
      return fakeAddon()
    })
    setRustCoreEnvironment({ host: MAC, load })
    expect(activeCore()).toBe('native')
    expect(load.mock.calls[1][0]).toMatch(/native[/\\]out[/\\]inup\.darwin-arm64\.node$/)
  })

  it.each([
    [
      'nothing loads',
      () => {
        throw new Error('dlopen: wrong architecture')
      },
    ],
    ['it throws something other than an Error', () => throwString()],
    ['the addon is from another ABI', () => fakeAddon({ abiVersion: () => 2 })],
    ['the addon predates abiVersion', () => ({ decodePackument: async () => parsed })],
    ['the export is missing', () => fakeAddon({ decodePackument: undefined })],
    ['the module is empty', () => null],
  ])('uses TypeScript when %s', (_label, load) => {
    const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
    setRustCoreEnvironment({ host: MAC, load })
    expect(activeCore()).toBe('js')
    expect(packumentDecoder()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][2]).toHaveLength(2)
  })

  it('does not try to load anything on hosts without a prebuilt addon', () => {
    const load = vi.fn()
    setRustCoreEnvironment({ host: { platform: 'freebsd', arch: 'x64', isMusl: false }, load })
    expect(activeCore()).toBe('js')
    expect(load).not.toHaveBeenCalled()
  })

  it('INUP_CORE=js forces TypeScript without loading the addon', () => {
    process.env.INUP_CORE = 'js'
    const load = vi.fn()
    setRustCoreEnvironment({ host: MAC, load })
    expect(activeCore()).toBe('js')
    expect(load).not.toHaveBeenCalled()
  })

  it('resolves once per process and logs the choice', () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    const load = vi.fn((_id: string) => fakeAddon())
    setRustCoreEnvironment({ host: MAC, load })
    const first = packumentDecoder()
    expect(packumentDecoder()).toBe(first)
    expect(activeCore()).toBe('native')
    expect(load).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('rust-core', 'registry decoder: native, transport: undici')
  })

  it('uses real host detection and require by default without throwing', () => {
    vi.spyOn(debugLog, 'warn').mockImplementation(() => {})
    // A dev checkout may have native/out built, CI does not: both must resolve cleanly.
    expect(['native', 'js']).toContain(activeCore())
  })
})

describe('native decoder', () => {
  const decoderWith = (decodePackument: (...args: unknown[]) => Promise<unknown>) => {
    setRustCoreEnvironment({ host: MAC, load: () => fakeAddon({ decodePackument }) })
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
    setRustCoreEnvironment({ host: MAC, load: () => addon })
    const transport = nativeTransport()
    if (!transport) throw new Error('expected the native transport')
    return transport
  }

  it('is available only when the addon exports the whole transport', () => {
    const info = vi.spyOn(debugLog, 'info').mockImplementation(() => {})
    setRustCoreEnvironment({ host: MAC, load: () => transportAddon() })
    expect(nativeTransport()).not.toBeNull()
    expect(info).toHaveBeenCalledWith('rust-core', 'registry decoder: native, transport: native')

    for (const missing of ['fetchPackument', 'cancelFetch', 'takeReceivedBytes']) {
      setRustCoreEnvironment({ host: MAC, load: () => transportAddon({ [missing]: undefined }) })
      expect(nativeTransport()).toBeNull()
      expect(activeCore()).toBe('native')
    }

    process.env.INUP_CORE = 'js'
    setRustCoreEnvironment({ host: MAC, load: () => transportAddon() })
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
