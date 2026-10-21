import { once } from 'node:events'
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import https from 'node:https'
import { POOL_CONNECTIONS, PROBE_CONNECTIONS } from '../config/constants'

/**
 * Minimal GET client on Node's built-in `http`/`https` modules: the TypeScript
 * registry transport, used whenever the native one is not.
 *
 * - One keep-alive agent per protocol, capped at the adaptive controller's
 *   ceiling so it is never silently throttled below its chosen limit. A second
 *   pool serves `latest` probes, so they never queue behind downloads.
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
}

export interface HttpRequestOptions {
  /** Path including query, e.g. `/@scope%2Fname`. */
  path: string
  /** Default GET. A HEAD response has an empty body. */
  method?: 'GET' | 'HEAD'
  headers: Record<string, string>
  /** `probe`: the connection pool for `latest` probes instead of the download pool. */
  pool?: 'probe'
  /** Time allowed until response headers arrive (connect included). */
  headersTimeoutMs: number
  signal?: AbortSignal
}

/** Rejection reason for a stalled request; classified as a transient network error. */
export class HeadersTimeoutError extends Error {
  override readonly name = 'HeadersTimeoutError'
}

const agentsFor = (maxSockets: number) => ({
  'http:': new http.Agent({ keepAlive: true, maxSockets, scheduling: 'lifo' }),
  'https:': new https.Agent({ keepAlive: true, maxSockets, scheduling: 'lifo' }),
})
const pools = { default: agentsFor(POOL_CONNECTIONS), probe: agentsFor(PROBE_CONNECTIONS) }

function bodyOf(response: IncomingMessage): HttpResponseBody {
  return {
    [Symbol.asyncIterator]: () => response[Symbol.asyncIterator](),
    dump: async () => {
      if (response.readableEnded) return
      const ended = once(response, 'end')
      response.resume()
      await ended
    },
  }
}

export function httpRequest(origin: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(origin)
  const protocol = url.protocol === 'http:' ? 'http:' : 'https:'
  const client = protocol === 'http:' ? http : https

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol,
        // URL keeps IPv6 literals bracketed; the socket layer wants them bare.
        hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
        port: url.port || undefined,
        path: options.path,
        method: options.method ?? 'GET',
        headers: options.headers,
        agent: pools[options.pool ?? 'default'][protocol],
        signal: options.signal,
      },
      (response) => {
        clearTimeout(timer)
        resolve({
          // Always set on a client response.
          statusCode: response.statusCode as number,
          headers: response.headers,
          body: bodyOf(response),
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
