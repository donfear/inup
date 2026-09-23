import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { registryTargetMock } = vi.hoisted(() => ({
  registryTargetMock: vi.fn((): { origin: string; pathPrefix: string; authHeader?: string } => ({
    origin: 'http://127.0.0.1:1',
    pathPrefix: '',
  })),
}))
vi.mock('../../../../src/shared/registry/registry-config', () => ({
  registryTargetFor: registryTargetMock,
}))

import {
  downloadNativeCore,
  extractTarEntry,
  NativeDownloadError,
  nativeCoreFile,
  nativePackageName,
  sha512Integrity,
  verifyIntegrity,
} from '../../../../src/shared/registry/native-download'

/** A minimal ustar archive: one header block + padded content per file. */
function tar(
  files: Array<{ name: string; content: Buffer; prefix?: string; type?: string; noSize?: boolean }>
) {
  const blocks: Buffer[] = []
  for (const file of files) {
    const header = Buffer.alloc(512)
    header.write(file.name, 0, 100, 'utf8')
    if (!file.noSize) {
      header.write(file.content.length.toString(8).padStart(11, '0'), 124, 12, 'utf8')
    }
    header.write(file.type ?? '0', 156, 1, 'utf8')
    header.write('ustar', 257, 6, 'utf8')
    if (file.prefix) header.write(file.prefix, 345, 155, 'utf8')
    blocks.push(header, file.content, Buffer.alloc((512 - (file.content.length % 512)) % 512))
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)])
}

const sri = (data: Buffer) => `sha512-${createHash('sha512').update(data).digest('base64')}`

const ADDON = Buffer.from('\x7fELF pretend addon bytes')
const ABI = 'darwin-arm64'
const VERSION = '1.8.0'
/** The addon hash this pretend inup release pinned. */
const PINNED = sri(ADDON)

describe('extractTarEntry', () => {
  it('finds a file by path, honoring the ustar prefix and skipping other entries', () => {
    const archive = tar([
      { name: 'package/package.json', content: Buffer.from('{}') },
      { name: 'package', content: Buffer.alloc(0), type: '5' },
      { name: 'inup.darwin-arm64.node', prefix: 'package', content: ADDON },
    ])
    expect(extractTarEntry(archive, 'package/inup.darwin-arm64.node')).toEqual(ADDON)
    expect(extractTarEntry(archive, 'package/package.json')).toEqual(Buffer.from('{}'))
  })

  it('treats an empty size field as an empty entry', () => {
    const archive = tar([
      { name: 'package/empty', content: Buffer.alloc(0), noSize: true },
      { name: 'package/inup.darwin-arm64.node', content: ADDON },
    ])
    expect(extractTarEntry(archive, 'package/empty')).toEqual(Buffer.alloc(0))
    expect(extractTarEntry(archive, 'package/inup.darwin-arm64.node')).toEqual(ADDON)
  })

  it('returns null for a missing entry, directories and truncated archives', () => {
    const archive = tar([{ name: 'package/other', content: Buffer.from('x') }])
    expect(extractTarEntry(archive, 'package/inup.node')).toBeNull()
    expect(
      extractTarEntry(tar([{ name: 'dir', content: Buffer.alloc(0), type: '5' }]), 'dir')
    ).toBeNull()
    expect(extractTarEntry(Buffer.alloc(100), 'anything')).toBeNull()
  })
})

describe('nativePackageName', () => {
  it.each([
    ['darwin-arm64', 'inup-darwin-arm64'],
    ['darwin-x64', 'inup-darwin-x64'],
    ['linux-x64-gnu', 'inup-linux-x64-gnu'],
    ['linux-arm64-gnu', 'inup-linux-arm64-gnu'],
    ['linux-x64-musl', 'inup-linux-x64-musl'],
    ['linux-arm64-musl', 'inup-linux-arm64-musl'],
    // npm's spam detection rejects the win32-*-msvc package names.
    ['win32-x64-msvc', 'inup-windows-x64'],
    ['win32-arm64-msvc', 'inup-windows-arm64'],
  ])('maps %s to %s', (abi, name) => {
    expect(nativePackageName(abi)).toBe(name)
  })
})

describe('verifyIntegrity', () => {
  it('uses the SRI form inup pins addons in', () => {
    expect(sha512Integrity(ADDON)).toBe(sri(ADDON))
  })

  it('accepts a matching sha512 among several SRI entries', () => {
    expect(() => verifyIntegrity(ADDON, `sha1-abc ${sri(ADDON)}?opt`)).not.toThrow()
  })

  it('rejects a mismatch and SRI strings without sha512', () => {
    expect(() => verifyIntegrity(ADDON, sri(Buffer.from('other')))).toThrow(
      'integrity check failed'
    )
    expect(() => verifyIntegrity(ADDON, 'sha1-abc')).toThrow('no sha512 integrity published')
  })
})

describe('downloadNativeCore', () => {
  let server: Server
  let origin = ''
  let cacheRoot = ''
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const seen: Array<{ url?: string; authorization?: string }> = []

  const tarball = gzipSync(
    tar([
      { name: 'package/package.json', content: Buffer.from('{"name":"inup-darwin-arm64"}') },
      { name: `package/inup.${ABI}.node`, content: ADDON },
    ])
  )

  const publish = (dist: Record<string, unknown>) =>
    routes.set(`/inup-${ABI}`, (_req, res) =>
      res.writeHead(200).end(JSON.stringify({ versions: { [VERSION]: { dist } } }))
    )

  beforeEach(async () => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'inup-native-download-'))
    server = createServer((req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization })
      const route = routes.get(req.url ?? '')
      if (route) route(req, res)
      else res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    registryTargetMock.mockReturnValue({ origin, pathPrefix: '', authHeader: 'Bearer secret' })
    routes.set('/tarballs/addon.tgz', (_req, res) => res.writeHead(200).end(tarball))
  })

  afterEach(async () => {
    routes.clear()
    seen.length = 0
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    rmSync(cacheRoot, { recursive: true, force: true })
  })

  it('verifies, extracts and caches the addon, removing older versions', async () => {
    publish({ tarball: `${origin}/tarballs/addon.tgz`, integrity: sri(tarball) })
    mkdirSync(join(cacheRoot, 'native', '1.7.0'), { recursive: true })

    const file = await downloadNativeCore({
      cacheRoot,
      version: VERSION,
      abi: ABI,
      integrity: PINNED,
    })

    expect(file).toBe(nativeCoreFile(cacheRoot, VERSION, ABI))
    expect(readFileSync(file)).toEqual(ADDON)
    expect(readdirSync(join(cacheRoot, 'native'))).toEqual([VERSION])
    expect(readdirSync(join(cacheRoot, 'native', VERSION))).toEqual([`inup.${ABI}.node`])
    // Registry credentials go to the registry origin, which also serves the tarball here.
    expect(seen.map((r) => r.authorization)).toEqual(['Bearer secret', 'Bearer secret'])
  })

  it('follows redirects and drops credentials when leaving the registry origin', async () => {
    const other = createServer((_req, res) => {
      seen.push({ url: 'other', authorization: _req.headers.authorization })
      res.writeHead(200).end(tarball)
    })
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve))
    const otherOrigin = `http://localhost:${(other.address() as AddressInfo).port}`
    try {
      publish({ tarball: `${origin}/tarballs/redirect.tgz`, integrity: sri(tarball) })
      routes.set('/tarballs/redirect.tgz', (_req, res) =>
        res.writeHead(302, { location: `${otherOrigin}/cdn/addon.tgz` }).end()
      )

      await downloadNativeCore({ cacheRoot, version: VERSION, abi: ABI, integrity: PINNED })

      expect(seen.at(-1)).toEqual({ url: 'other', authorization: undefined })
      expect(existsSync(nativeCoreFile(cacheRoot, VERSION, ABI))).toBe(true)
    } finally {
      other.closeAllConnections()
      await new Promise((resolve) => other.close(resolve))
    }
  })

  it('sends no credentials to a tarball host other than the registry', async () => {
    registryTargetMock.mockReturnValue({
      origin: `http://localhost:${new URL(origin).port}`,
      pathPrefix: '',
      authHeader: 'Bearer secret',
    })
    publish({ tarball: `${origin}/tarballs/addon.tgz`, integrity: sri(tarball) })
    await downloadNativeCore({ cacheRoot, version: VERSION, abi: ABI, integrity: PINNED })
    expect(seen.map((r) => r.authorization)).toEqual(['Bearer secret', undefined])
  })

  it('fetches Windows addons from the inup-windows-<arch> package', async () => {
    const winAbi = 'win32-x64-msvc'
    const winTarball = gzipSync(tar([{ name: `package/inup.${winAbi}.node`, content: ADDON }]))
    routes.set('/tarballs/win.tgz', (_req, res) => res.writeHead(200).end(winTarball))
    routes.set('/inup-windows-x64', (_req, res) =>
      res.writeHead(200).end(
        JSON.stringify({
          versions: {
            [VERSION]: {
              dist: { tarball: `${origin}/tarballs/win.tgz`, integrity: sri(winTarball) },
            },
          },
        })
      )
    )

    const file = await downloadNativeCore({
      cacheRoot,
      version: VERSION,
      abi: winAbi,
      integrity: PINNED,
    })

    expect(file).toBe(nativeCoreFile(cacheRoot, VERSION, winAbi))
    expect(readFileSync(file)).toEqual(ADDON)
    expect(seen[0].url).toBe('/inup-windows-x64')
  })

  it('gives up after too many redirects', async () => {
    publish({ tarball: `${origin}/loop`, integrity: sri(tarball) })
    routes.set('/loop', (_req, res) => res.writeHead(301, { location: '/loop' }).end())
    await expect(
      downloadNativeCore({ cacheRoot, version: VERSION, abi: ABI, integrity: PINNED })
    ).rejects.toThrow('too many redirects')
  })

  it.each([
    ['the package is missing', (_base: string) => {}, 'returned 404'],
    ['the version is not published', () => publish({ tarball: 'x' }), 'is not published'],
    [
      'the tarball fails integrity',
      (base: string) =>
        publish({ tarball: `${base}/tarballs/addon.tgz`, integrity: sri(Buffer.from('tampered')) }),
      'integrity check failed',
    ],
    [
      // What a project .npmrc pointing at another registry can serve: the
      // reported integrity is right for the tarball, the addon is not inup's.
      'the registry vouches for an addon this release did not pin',
      (base: string) => {
        const evil = gzipSync(
          tar([{ name: `package/inup.${ABI}.node`, content: Buffer.from('x') }])
        )
        routes.set('/tarballs/evil.tgz', (_req, res) => res.writeHead(200).end(evil))
        publish({ tarball: `${base}/tarballs/evil.tgz`, integrity: sri(evil) })
      },
      `inup-${ABI}@${VERSION} does not match the native core released with this inup`,
    ],
    [
      'the tarball lacks the addon',
      (base: string) => {
        const empty = gzipSync(tar([{ name: 'package/package.json', content: Buffer.from('{}') }]))
        routes.set('/tarballs/empty.tgz', (_req, res) => res.writeHead(200).end(empty))
        publish({ tarball: `${base}/tarballs/empty.tgz`, integrity: sri(empty) })
      },
      `has no inup.${ABI}.node`,
    ],
  ])('fails without caching anything when %s', async (_label, setup, message) => {
    setup(origin)
    const error = await downloadNativeCore({
      cacheRoot,
      version: VERSION,
      abi: ABI,
      integrity: PINNED,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NativeDownloadError)
    expect((error as Error).message).toContain(message)
    expect(existsSync(join(cacheRoot, 'native'))).toBe(false)
  })

  it('refuses downloads beyond the size limit', async () => {
    publish({ tarball: `${origin}/huge`, integrity: sri(tarball) })
    routes.set('/huge', (_req, res) => {
      res.writeHead(200)
      const chunk = Buffer.alloc(8 * 1024 * 1024)
      for (let i = 0; i < 9; i++) res.write(chunk)
      res.end()
    })
    await expect(
      downloadNativeCore({ cacheRoot, version: VERSION, abi: ABI, integrity: PINNED })
    ).rejects.toThrow('size limit')
  })

  it('sends no authorization header when the registry has no credentials', async () => {
    registryTargetMock.mockReturnValue({ origin, pathPrefix: '' })
    publish({ tarball: `${origin}/tarballs/addon.tgz`, integrity: sri(tarball) })
    writeFileSync(join(cacheRoot, 'unrelated'), '')
    await downloadNativeCore({ cacheRoot, version: VERSION, abi: ABI, integrity: PINNED })
    expect(seen.map((r) => r.authorization)).toEqual([undefined, undefined])
  })
})
