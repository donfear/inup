import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  configureNativeCore,
  detectHost,
  type NativeTransport,
  nativeAbi,
  nativeTransport,
  setRustCoreEnvironment,
} from '../../../../src/shared/registry/rust-core'
import { parseVersions } from '../../../../src/shared/versions'

// The real native transport against a local registry stand-in. Skipped where
// the addon is not built; INUP_PARITY_REQUIRED=1 (CI) turns that into a failure.
const abi = nativeAbi(detectHost())
const devBuild = abi
  ? join(__dirname, '..', '..', '..', '..', 'native', 'out', `inup.${abi}.node`)
  : null
const built = devBuild !== null && existsSync(devBuild)
const required = process.env.INUP_PARITY_REQUIRED === '1'
const testRequire = createRequire(__filename)

type Handler = (res: ServerResponse, headers: IncomingHttpHeaders) => void

const packument = {
  name: 'demo',
  versions: {
    '1.0.0': {},
    '1.2.0': { deprecated: 'use 2.x' },
    '2.0.0-rc.1': {},
  },
}
const body = Buffer.from(JSON.stringify(packument))
const expected = parseVersions(body.toString('utf8'))

describe.skipIf(!built && !required)('native transport parity', () => {
  let server: Server
  let base = ''
  let tmp = ''
  const routes = new Map<string, Handler>()
  const seen = new Map<string, IncomingHttpHeaders>()
  let transport: NativeTransport

  beforeAll(async () => {
    configureNativeCore({ enabled: true })
    setRustCoreEnvironment({ load: testRequire, download: async () => 'unused' })
    const loaded = nativeTransport()
    if (!loaded) throw new Error('native transport failed to load')
    transport = loaded
    tmp = mkdtempSync(join(tmpdir(), 'inup-transport-'))
    server = createServer((req, res) => {
      const path = req.url ?? ''
      seen.set(path, req.headers)
      const handler = routes.get(path)
      if (handler) handler(res, req.headers)
      else res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    configureNativeCore({ enabled: false })
    setRustCoreEnvironment(null)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    rmSync(tmp, { recursive: true, force: true })
  })

  const fetchPath = (path: string, extra: Record<string, unknown> = {}, signal?: AbortSignal) =>
    transport.fetch({ url: `${base}${path}`, cacheFile: null, ...extra }, signal)

  it.each([
    ['identity', (b: Buffer) => b],
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)(
    'decodes a %s 200, writes the cache entry and counts bytes',
    async (encoding, compress) => {
      const payload = compress(body)
      routes.set(`/ok-${encoding}`, (res) =>
        res
          .writeHead(200, {
            'content-type': 'application/json',
            etag: `W/"${encoding}"`,
            ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
          })
          .end(payload)
      )
      const cacheFile = join(tmp, `ok-${encoding}.json`)
      transport.takeReceivedBytes()

      const outcome = await fetchPath(`/ok-${encoding}`, {
        cacheFile,
        authorization: 'Bearer token',
      })

      expect(outcome.kind).toBe('success')
      expect(JSON.parse(outcome.dataJson ?? 'null')).toEqual(JSON.parse(JSON.stringify(expected)))
      expect(outcome.revalidated).toBe(false)
      expect(outcome.bytes).toBe(payload.length)
      expect(transport.takeReceivedBytes()).toBe(payload.length)
      expect(readFileSync(cacheFile, 'utf8')).toBe(
        JSON.stringify({ etag: `W/"${encoding}"`, data: expected })
      )
      const headers = seen.get(`/ok-${encoding}`)
      expect(headers?.accept).toBe('application/vnd.npm.install-v1+json')
      expect(headers?.['accept-encoding']).toBe('gzip, deflate, br')
      expect(headers?.authorization).toBe('Bearer token')
      expect(headers?.['if-none-match']).toBeUndefined()
    }
  )

  it('revalidates with the stored ETag and reuses the cached data on 304', async () => {
    const cacheFile = join(tmp, 'revalidate.json')
    writeFileSync(cacheFile, JSON.stringify({ etag: 'W/"v7"', data: expected }))
    routes.set('/revalidate', (res, headers) =>
      headers['if-none-match'] === 'W/"v7"' ? res.writeHead(304).end() : res.writeHead(500).end()
    )

    const outcome = await fetchPath('/revalidate', { cacheFile })

    expect(outcome).toMatchObject({ kind: 'success', revalidated: true, bytes: 0, status: 304 })
    expect(JSON.parse(outcome.dataJson ?? 'null')).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  it('ignores unreadable cache entries (no conditional request)', async () => {
    const cacheFile = join(tmp, 'corrupt.json')
    writeFileSync(cacheFile, '{not json')
    routes.set('/corrupt-cache', (res) => res.writeHead(200).end(body))
    const outcome = await fetchPath('/corrupt-cache', { cacheFile })
    expect(outcome.kind).toBe('success')
    expect(seen.get('/corrupt-cache')?.['if-none-match']).toBeUndefined()
  })

  it.each([
    [304, 'not-found'],
    [400, 'not-found'],
    // The status is what tells a refusal apart; the JS side reads it.
    [401, 'not-found'],
    [403, 'not-found'],
    [404, 'not-found'],
    [408, 'retryable'],
    [500, 'retryable'],
    [502, 'retryable'],
    [429, 'congested'],
    [503, 'congested'],
  ])('classifies HTTP %i as %s, like the undici transport', async (status, kind) => {
    routes.set(`/status-${status}`, (res) =>
      res.writeHead(status, status === 429 ? { 'retry-after': '7' } : {}).end()
    )
    const outcome = await fetchPath(`/status-${status}`)
    expect(outcome.kind).toBe(kind)
    expect(outcome.status).toBe(status)
    if (status === 429) expect(outcome.retryAfter).toBe('7')
  })

  it('reports an undecodable body as transient and writes no cache entry', async () => {
    routes.set('/garbage', (res) => res.writeHead(200, { etag: 'W/"g"' }).end('{"versions":'))
    const cacheFile = join(tmp, 'garbage.json')
    const outcome = await fetchPath('/garbage', { cacheFile })
    expect(outcome).toMatchObject({ kind: 'transient', errorClass: 'decode' })
    expect(existsSync(cacheFile)).toBe(false)
  })

  it('times out a stalled response as transient', async () => {
    routes.set('/stall', () => {})
    const outcome = await fetchPath('/stall', { headersTimeoutMs: 150 })
    expect(outcome).toMatchObject({ kind: 'transient', errorClass: 'timeout' })
  })

  it('reports a refused connection as transient', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise((resolve) => closed.close(resolve))
    const outcome = await transport.fetch({ url: `http://127.0.0.1:${port}/x`, cacheFile: null })
    expect(outcome).toMatchObject({ kind: 'transient', errorClass: 'connect' })
  })

  it('asks for the undici fallback when TLS cannot be established', async () => {
    routes.set('/tls', (res) => res.writeHead(200).end(body))
    const outcome = await transport.fetch({
      url: `${base.replace('http:', 'https:')}/tls`,
      cacheFile: null,
    })
    expect(outcome).toMatchObject({ kind: 'fallback', errorClass: 'tls' })
  })

  it('resolves as cancelled when the signal aborts mid-download', async () => {
    routes.set('/slow', (res) => {
      res.writeHead(200)
      res.write(body.subarray(0, 10))
    })
    const controller = new AbortController()
    const pending = fetchPath('/slow', {}, controller.signal)
    setTimeout(() => controller.abort(), 50)
    expect((await pending).kind).toBe('cancelled')
  })
})
