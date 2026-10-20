import { once } from 'node:events'
import http, { type IncomingHttpHeaders } from 'node:http'
import http2, { type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2'
import https from 'node:https'
import { isIP } from 'node:net'
import { PassThrough, type Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import tls, { type TLSSocket } from 'node:tls'
import { POOL_CONNECTIONS } from '../config/constants'

/**
 * Minimal GET client on Node's built-in `http`/`https`/`http2` modules: the
 * TypeScript registry transport, used whenever the native one is not.
 *
 * - HTTPS origins are offered HTTP/2 (ALPN). One session per origin then
 *   carries every request as a stream, with large flow-control windows: at
 *   the 64 KiB defaults, big packuments crawl. An origin that answers with
 *   HTTP/1.1 (common for private registries) uses the keep-alive agent for
 *   the rest of the process.
 * - One keep-alive agent per protocol, capped at the adaptive controller's
 *   ceiling so it is never silently throttled below its chosen limit.
 * - The body is streamed raw: no automatic decompression, so the controller
 *   can account compressed bytes and the decoder gets the original encoding.
 * - A headers timeout catches stalled connections (they would otherwise be
 *   invisible to the completion-based controller); bodies have no timeout,
 *   because large packuments legitimately stream slowly on slow links.
 */

export interface HttpResponseBody extends AsyncIterable<Buffer> {
  /** Discard the rest of the body so the connection can be reused. */
  dump(): Promise<void>
}

export interface HttpResponse {
  statusCode: number
  headers: IncomingHttpHeaders
  body: HttpResponseBody
  /** Came over an HTTP/2 session, where a request costs a stream, not a socket. */
  multiplexed: boolean
}

export interface HttpRequestOptions {
  /** Path including query, e.g. `/@scope%2Fname`. */
  path: string
  headers: Record<string, string>
  /** Time allowed until response headers arrive (connect included). */
  headersTimeoutMs: number
  signal?: AbortSignal
}

/** Rejection reason for a stalled request; classified as a transient network error. */
export class HeadersTimeoutError extends Error {
  override readonly name = 'HeadersTimeoutError'
}

/** The server refused a stream it never processed (GOAWAY): safe to send again. */
class StreamRefusedError extends Error {
  override readonly name = 'StreamRefusedError'
}

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: POOL_CONNECTIONS, scheduling: 'lifo' }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: POOL_CONNECTIONS, scheduling: 'lifo' }),
}

// Kept equal to the native transport (native/napi/src/http.rs). A cold run
// streams megabytes per packument; with the default windows the server stalls
// every 64 KiB waiting for a window update.
const STREAM_WINDOW_BYTES = 2 ** 24
const SESSION_WINDOW_BYTES = 2 ** 28

/** An origin's HTTP/2 session. It keeps the process alive only while a stream is open. */
class Http2Origin {
  private open = 0

  constructor(
    private readonly session: ClientHttp2Session,
    private readonly forget: () => void
  ) {
    session.unref()
    // No new streams once the server says goodbye or the connection fails;
    // the next request negotiates a fresh session.
    session.on('goaway', forget)
    session.on('close', forget)
    session.on('error', forget)
  }

  request(options: HttpRequestOptions): ClientHttp2Stream {
    const stream = this.session.request(
      { ':path': options.path, ...options.headers },
      { endStream: true, signal: options.signal }
    )
    if (this.open++ === 0) this.session.ref()
    stream.once('close', () => {
      if (--this.open === 0) this.session.unref()
    })
    return stream
  }

  /** Stop using this session; streams still open on it finish first. */
  retire(): void {
    this.forget()
    this.session.close()
  }
}

/** How an origin is reached: its HTTP/2 session, or the HTTP/1.1 agent. */
type Route = Http2Origin | 'http/1.1'

const routes = new Map<string, Promise<Route>>()

// URL keeps IPv6 literals bracketed; the socket layer wants them bare.
const hostOf = (url: URL) => url.hostname.replace(/^\[(.*)\]$/, '$1')

/** Connect once and let the server pick the protocol. */
function negotiate(url: URL, timeoutMs: number, forget: () => void): Promise<Route> {
  return new Promise((resolve, reject) => {
    const host = hostOf(url)
    const socket: TLSSocket = tls.connect({
      host,
      port: Number(url.port) || 443,
      // SNI carries host names only.
      servername: isIP(host) ? undefined : host,
      ALPNProtocols: ['h2', 'http/1.1'],
    })
    const timer = setTimeout(() => {
      socket.destroy(new HeadersTimeoutError(`no TLS handshake within ${timeoutMs} ms`))
    }, timeoutMs)
    const fail = (error: Error) => {
      clearTimeout(timer)
      reject(error)
    }
    socket.once('error', fail)
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      socket.off('error', fail)
      if (socket.alpnProtocol !== 'h2') {
        // The agent dials its own sockets; this one only asked the question.
        socket.destroy()
        resolve('http/1.1')
        return
      }
      const session = http2.connect(url.origin, {
        createConnection: () => socket,
        settings: { initialWindowSize: STREAM_WINDOW_BYTES },
      })
      session.setLocalWindowSize(SESSION_WINDOW_BYTES)
      resolve(new Http2Origin(session, forget))
    })
  })
}

/** The route to an HTTPS origin, negotiated by the first request and shared by the rest. */
function routeFor(url: URL, timeoutMs: number): Promise<Route> {
  const known = routes.get(url.origin)
  if (known) return known
  const forget = () => {
    if (routes.get(url.origin) === route) routes.delete(url.origin)
  }
  const route = negotiate(url, timeoutMs, forget)
  routes.set(url.origin, route)
  // A failed connection is not remembered: the next request tries again.
  route.catch(forget)
  return route
}

/** `pending`, or the signal's abort reason as soon as it aborts. */
async function unlessAborted<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  signal.throwIfAborted()
  const settled = new AbortController()
  const aborted = once(signal, 'abort', { signal: settled.signal }).then(() =>
    Promise.reject(signal.reason)
  )
  try {
    return await Promise.race([pending, aborted])
  } finally {
    settled.abort()
  }
}

function bodyOf(stream: Readable): HttpResponseBody {
  return {
    [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
    dump: async () => {
      if (stream.readableEnded) return
      stream.resume()
      await finished(stream, { writable: false })
    },
  }
}

/**
 * An HTTP/2 response body, relayed through a plain stream: once the HTTP/2
 * stream has closed, Node's async iterator reports a premature close even with
 * the whole body still buffered — the norm for a small body read a moment
 * after its headers. A connection lost mid-body can end the stream as if it
 * were complete; the decoders reject the truncated payload.
 */
function http2BodyOf(stream: ClientHttp2Stream): HttpResponseBody {
  const body = new PassThrough()
  stream.pipe(body)
  stream.on('error', (error) => body.destroy(error))
  stream.on('close', () => {
    if (!body.writableEnded) body.destroy(new Error(`stream closed (code ${stream.rstCode})`))
  })
  return bodyOf(body)
}

function requestHttp1(url: URL, options: HttpRequestOptions): Promise<HttpResponse> {
  const protocol = url.protocol === 'http:' ? 'http:' : 'https:'
  const client = protocol === 'http:' ? http : https

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol,
        hostname: hostOf(url),
        // Empty for the protocol's default port, which Node then picks.
        port: url.port,
        path: options.path,
        method: 'GET',
        headers: options.headers,
        agent: agents[protocol],
        signal: options.signal,
      },
      (response) => {
        clearTimeout(timer)
        resolve({
          // Always set on a client response.
          statusCode: response.statusCode as number,
          headers: response.headers,
          body: bodyOf(response),
          multiplexed: false,
        })
      }
    )
    const timer = setTimeout(() => {
      request.destroy(
        new HeadersTimeoutError(`no response headers within ${options.headersTimeoutMs} ms`)
      )
    }, options.headersTimeoutMs)
    request.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.end()
  })
}

function requestHttp2(origin: Http2Origin, options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const stream = origin.request(options)
    const timer = setTimeout(() => {
      reject(new HeadersTimeoutError(`no response headers within ${options.headersTimeoutMs} ms`))
      stream.close(http2.constants.NGHTTP2_CANCEL)
      // A session that leaves a stream unanswered this long is likely dead.
      origin.retire()
    }, options.headersTimeoutMs)
    // Settles nothing once the response is in: the body reports later failures.
    const fail = (error: Error) => {
      clearTimeout(timer)
      const refused =
        stream.rstCode === http2.constants.NGHTTP2_REFUSED_STREAM ||
        (error as NodeJS.ErrnoException).code === 'ERR_HTTP2_GOAWAY_SESSION'
      reject(refused ? new StreamRefusedError(error.message) : error)
    }
    stream.once('response', (headers) => {
      clearTimeout(timer)
      resolve({
        // Always set on a response.
        statusCode: headers[':status'] as number,
        headers,
        body: http2BodyOf(stream),
        multiplexed: true,
      })
    })
    stream.on('error', fail)
    stream.once('close', () => fail(new Error(`stream closed (code ${stream.rstCode})`)))
  })
}

async function send(
  url: URL,
  options: HttpRequestOptions,
  startedAt: number,
  mayResend: boolean
): Promise<HttpResponse> {
  const route = await unlessAborted(routeFor(url, options.headersTimeoutMs), options.signal)
  // Connecting counts against the headers timeout.
  const rest = { ...options, headersTimeoutMs: options.headersTimeoutMs - (Date.now() - startedAt) }
  if (route === 'http/1.1') return requestHttp1(url, rest)
  try {
    return await requestHttp2(route, rest)
  } catch (error) {
    if (!(mayResend && error instanceof StreamRefusedError)) throw error
    // Sent while the session was going away: once more, on a fresh one.
    return send(url, options, startedAt, false)
  }
}

export function httpRequest(origin: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(origin)
  if (url.protocol === 'http:') return requestHttp1(url, options)
  return send(url, options, Date.now(), true)
}
