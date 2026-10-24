import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  createSecureServer,
  type Http2SecureServer,
  constants as h2,
  type IncomingHttpHeaders,
  type ServerHttp2Stream,
} from 'node:http2'
import { createServer as createHttpsServer } from 'node:https'
import { type AddressInfo, createServer as createTcpServer } from 'node:net'
import tls from 'node:tls'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HeadersTimeoutError, httpRequest } from '../../../../src/shared/http/http-request'
import { LOCALHOST_CERT, LOCALHOST_KEY } from '../../../fixtures/tls-localhost'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

type Closable = Pick<Server, 'close'> & { closeAllConnections?: () => void }

const servers: Closable[] = []

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
    server.closeAllConnections?.()
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

  it('rejects with a HeadersTimeoutError when headers never arrive', async () => {
    const { port } = await serve(() => {})
    const error = await get(`http://127.0.0.1:${port}`, '/', { headersTimeoutMs: 50 }).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(HeadersTimeoutError)
    expect(error).toMatchObject({ name: 'HeadersTimeoutError' })
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

// The HTTPS path against local servers with a self-signed certificate, which
// the test trusts for this thread. Node 22.19 may predate the API: skipped there.
describe.skipIf(typeof tls.setDefaultCACertificates !== 'function')(
  'httpRequest over HTTPS',
  () => {
    let defaultCAs: string[] = []

    beforeAll(() => {
      defaultCAs = tls.getCACertificates('default')
      tls.setDefaultCACertificates([...defaultCAs, LOCALHOST_CERT])
    })

    afterAll(() => {
      tls.setDefaultCACertificates(defaultCAs)
    })

    type StreamHandler = (
      stream: ServerHttp2Stream,
      headers: IncomingHttpHeaders,
      session: number
    ) => void

    /** HTTP/2 server; the handler learns which session (1-based) a stream is on. */
    async function serveH2(handler: StreamHandler, allowHTTP1 = false) {
      const server: Http2SecureServer = createSecureServer({
        key: LOCALHOST_KEY,
        cert: LOCALHOST_CERT,
        allowHTTP1,
      })
      let sessions = 0
      const open = new Set<{ destroy(): void }>()
      server.on('session', (session) => {
        const id = ++sessions
        open.add(session)
        session.on('close', () => open.delete(session))
        session.on('error', () => {})
        session.on('stream', (stream, headers) => {
          stream.on('error', () => {})
          handler(stream, headers, id)
        })
      })
      servers.push({
        close: (done) => server.close(done),
        closeAllConnections: () => {
          for (const session of open) session.destroy()
        },
      } as Closable)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      return { origin: `https://127.0.0.1:${port}`, port, sessions: () => sessions }
    }

    it.each([
      ['an HTTP/2-only server', false],
      ['a server that also speaks HTTP/1.1', true],
    ])('speaks HTTP/2 to %s, all requests on one session', async (_name, allowHTTP1) => {
      const seen: IncomingHttpHeaders[] = []
      const server = await serveH2((stream, headers) => {
        seen.push(headers)
        stream.respond({ ':status': 200, 'content-encoding': 'br', etag: 'W/"1"' })
        stream.write('chunk-1|')
        stream.end('chunk-2')
      }, allowHTTP1)

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          get(server.origin, '/@scope%2Fpkg', {
            headers: { accept: 'application/json', 'accept-encoding': 'br' },
          })
        )
      )

      for (const response of responses) {
        expect(response.statusCode).toBe(200)
        expect(response.multiplexed).toBe(true)
        expect(response.headers.etag).toBe('W/"1"')
        expect(response.headers['content-encoding']).toBe('br')
        expect(await readAll(response.body)).toBe('chunk-1|chunk-2')
      }
      expect(server.sessions()).toBe(1)
      expect(seen).toHaveLength(5)
      expect(seen[0]).toMatchObject({
        ':path': '/@scope%2Fpkg',
        ':method': 'GET',
        accept: 'application/json',
        'accept-encoding': 'br',
      })
    })

    it('reaches a host name origin (SNI) over HTTP/2', async () => {
      const server = await serveH2((stream) =>
        stream.respond({ ':status': 204 }, { endStream: true })
      )
      const response = await get(`https://localhost:${server.port}`)
      expect(response.statusCode).toBe(204)
      expect(response.multiplexed).toBe(true)
    })

    it('falls back to HTTP/1.1 for an origin that does not negotiate h2, and remembers it', async () => {
      const server = createHttpsServer({ key: LOCALHOST_KEY, cert: LOCALHOST_CERT }, (_req, res) =>
        res.end('over h1')
      )
      let connections = 0
      server.on('connection', () => connections++)
      servers.push(server)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`

      for (let i = 0; i < 3; i++) {
        const response = await get(origin)
        expect(response.multiplexed).toBe(false)
        expect(await readAll(response.body)).toBe('over h1')
      }
      // The negotiation probe, then one keep-alive socket for every request.
      expect(connections).toBe(2)
    })

    it('dump() drains an unread HTTP/2 body, and is safe to repeat', async () => {
      const server = await serveH2((stream) => {
        stream.respond({ ':status': 404 })
        stream.end('not here')
      })
      const first = await get(server.origin)
      await first.body.dump()
      await first.body.dump()
      const second = await get(server.origin)
      expect(second.statusCode).toBe(404)
      await second.body.dump()
      expect(server.sessions()).toBe(1)
    })

    /** Go away without processing the stream, as a server shutting down does. */
    const refuse = (stream: ServerHttp2Stream) => {
      stream.session?.goaway(h2.NGHTTP2_NO_ERROR)
      stream.close(h2.NGHTTP2_REFUSED_STREAM)
    }

    it('resends a stream refused by GOAWAY once, on a fresh session', async () => {
      const server = await serveH2((stream, _headers, session) => {
        // The first session goes away before processing anything.
        if (session === 1) refuse(stream)
        else stream.respond({ ':status': 200 }, { endStream: true })
      })
      const response = await get(server.origin)
      expect(response.statusCode).toBe(200)
      expect(server.sessions()).toBe(2)
    })

    it('gives up when the resent stream is refused too', async () => {
      const server = await serveH2(refuse)
      await expect(get(server.origin)).rejects.toMatchObject({ name: 'StreamRefusedError' })
      expect(server.sessions()).toBe(2)
    })

    it('opens a fresh session for requests after a GOAWAY', async () => {
      const server = await serveH2((stream) => {
        stream.respond({ ':status': 200 })
        stream.end('ok')
        stream.session?.goaway(h2.NGHTTP2_NO_ERROR, stream.id)
      })
      await readAll((await get(server.origin)).body)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await readAll((await get(server.origin)).body)
      expect(server.sessions()).toBe(2)
    })

    it('times out an unanswered HTTP/2 stream and retires its session', async () => {
      const server = await serveH2((stream, _headers, session) => {
        if (session > 1) stream.respond({ ':status': 200 }, { endStream: true })
      })
      const error = await get(server.origin, '/', { headersTimeoutMs: 100 }).catch(
        (e: unknown) => e
      )
      expect(error).toBeInstanceOf(HeadersTimeoutError)
      expect((await get(server.origin)).statusCode).toBe(200)
      expect(server.sessions()).toBe(2)
    })

    it('rejects when the session dies before the response', async () => {
      const server = await serveH2((stream) => stream.session?.destroy())
      await expect(get(server.origin)).rejects.toThrow(/stream closed/)
    })

    it('reads a body that arrived in full before it is read', async () => {
      const server = await serveH2((stream) => {
        stream.respond({ ':status': 200 })
        stream.end('all of it')
      })
      const response = await get(server.origin)
      // By now the stream has closed with the body still buffered.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(await readAll(response.body)).toBe('all of it')
    })

    it('reports an abort after the headers through the body', async () => {
      const server = await serveH2((stream) => {
        stream.respond({ ':status': 200 })
        stream.write('partial')
      })
      const controller = new AbortController()
      const response = await get(server.origin, '/', { signal: controller.signal })
      const reading = readAll(response.body)
      setTimeout(() => controller.abort(), 30)
      await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('rejects when the signal aborts an HTTP/2 request', async () => {
      const server = await serveH2(() => {})
      const controller = new AbortController()
      const pending = get(server.origin, '/', { signal: controller.signal })
      setTimeout(() => controller.abort(), 50)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    })

    /** A TCP server that accepts connections and never answers: TLS stalls. */
    async function serveSilence() {
      let connections = 0
      const server = createTcpServer((socket) => {
        connections++
        socket.on('error', () => {})
      })
      const sockets = new Set<{ destroy(): void }>()
      server.on('connection', (socket) => sockets.add(socket))
      servers.push({
        close: (done) => server.close(done),
        closeAllConnections: () => {
          for (const socket of sockets) socket.destroy()
        },
      } as Closable)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      return { origin: `https://127.0.0.1:${port}`, connections: () => connections }
    }

    it('times out a stalled TLS handshake, and tries again on the next request', async () => {
      const server = await serveSilence()
      for (let i = 0; i < 2; i++) {
        const error = await get(server.origin, '/', { headersTimeoutMs: 80 }).catch(
          (e: unknown) => e
        )
        expect(error).toBeInstanceOf(HeadersTimeoutError)
      }
      expect(server.connections()).toBe(2)
    })

    it('rejects when the signal aborts while the connection is negotiated', async () => {
      const server = await serveSilence()
      const controller = new AbortController()
      const pending = get(server.origin, '/', { signal: controller.signal })
      setTimeout(() => controller.abort(), 30)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

      controller.abort()
      await expect(get(server.origin, '/', { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError',
      })
    })
  }
)
