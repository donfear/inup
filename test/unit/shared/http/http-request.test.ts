import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { HeadersTimeoutError, httpRequest } from '../../../../src/shared/http/http-request'
import { isTransientNetworkError } from '../../../../src/shared/http/retry'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const servers: Server[] = []

async function serve(handler: Handler, host = '127.0.0.1') {
  const server = createServer(handler)
  let connections = 0
  server.on('connection', () => connections++)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  const { port } = server.address() as AddressInfo
  return { port, connections: () => connections }
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

const get = (origin: string, path = '/', extra: Partial<Parameters<typeof httpRequest>[1]> = {}) =>
  httpRequest(origin, { path, headers: {}, headersTimeoutMs: 2000, ...extra })

async function readAll(body: AsyncIterable<Buffer>) {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

describe('httpRequest', () => {
  it('sends the path and headers, and streams the raw body', async () => {
    const seen: Array<{ url?: string; accept?: string; encoding?: string }> = []
    const { port } = await serve((req, res) => {
      seen.push({
        url: req.url,
        accept: req.headers.accept,
        encoding: req.headers['accept-encoding'],
      })
      res.writeHead(200, { 'content-encoding': 'br', etag: 'W/"1"' })
      res.write('chunk-1|')
      res.end('chunk-2')
    })

    const response = await get(`http://127.0.0.1:${port}`, '/@scope%2Fpkg', {
      headers: { accept: 'application/json', 'accept-encoding': 'br' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).toBe('W/"1"')
    // Compressed bodies are not decoded: the caller sees the bytes as sent.
    expect(response.headers['content-encoding']).toBe('br')
    expect(await readAll(response.body)).toBe('chunk-1|chunk-2')
    expect(seen).toEqual([{ url: '/@scope%2Fpkg', accept: 'application/json', encoding: 'br' }])
  })

  it('reuses one keep-alive connection for sequential requests', async () => {
    const server = await serve((_req, res) => res.end('ok'))
    const origin = `http://127.0.0.1:${server.port}`
    for (let i = 0; i < 3; i++) {
      const response = await get(origin)
      await readAll(response.body)
    }
    expect(server.connections()).toBe(1)
  })

  it('dump() drains an unread body so the connection is reused, and is safe to repeat', async () => {
    const server = await serve((_req, res) => res.writeHead(404).end('not here'))
    const origin = `http://127.0.0.1:${server.port}`

    const first = await get(origin)
    await first.body.dump()
    await first.body.dump()
    const second = await get(origin)
    expect(second.statusCode).toBe(404)
    await second.body.dump()

    expect(server.connections()).toBe(1)
  })

  it('rejects with a transient HeadersTimeoutError when headers never arrive', async () => {
    const { port } = await serve(() => {})
    const error = await get(`http://127.0.0.1:${port}`, '/', { headersTimeoutMs: 50 }).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(HeadersTimeoutError)
    expect(error).toMatchObject({ name: 'HeadersTimeoutError', code: 'UND_ERR_HEADERS_TIMEOUT' })
    expect(isTransientNetworkError(error)).toBe(true)
  })

  it('does not time out a body that streams slowly after the headers', async () => {
    const { port } = await serve((_req, res) => {
      res.writeHead(200)
      res.write('a')
      setTimeout(() => res.end('b'), 120)
    })
    const response = await get(`http://127.0.0.1:${port}`, '/', { headersTimeoutMs: 50 })
    expect(await readAll(response.body)).toBe('ab')
  })

  it('rejects when the signal aborts', async () => {
    const { port } = await serve(() => {})
    const controller = new AbortController()
    const pending = get(`http://127.0.0.1:${port}`, '/', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects with the socket error when nothing listens', async () => {
    const { port } = await serve(() => {})
    await new Promise((resolve) => servers.pop()?.close(resolve))
    const error = await get(`http://127.0.0.1:${port}`).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'ECONNREFUSED' })
    expect(isTransientNetworkError(error)).toBe(true)
  })

  it('speaks TLS for https origins (and defaults the port)', async () => {
    const { port } = await serve((_req, res) => res.end('plain http'))
    // A TLS handshake against a plain HTTP server fails at the TLS layer.
    await expect(get(`https://127.0.0.1:${port}`)).rejects.toThrow()
    // No port in the origin: 443 on localhost is not listening.
    await expect(get('https://127.0.0.1')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('connects to bracketed IPv6 origins', async (context) => {
    let server: Awaited<ReturnType<typeof serve>>
    try {
      server = await serve((_req, res) => res.end('v6'), '::1')
    } catch {
      context.skip()
      return
    }
    const response = await get(`http://[::1]:${server.port}`)
    expect(await readAll(response.body)).toBe('v6')
  })
})
