import { once } from 'node:events'
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import https from 'node:https'
import { POOL_CONNECTIONS } from '../config/constants'

/**
 * Minimal GET client on Node's built-in `http`/`https` modules: the TypeScript
 * registry transport, used whenever the native one is not.
 *
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
  readonly code = 'UND_ERR_HEADERS_TIMEOUT'
}

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: POOL_CONNECTIONS, scheduling: 'lifo' }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: POOL_CONNECTIONS, scheduling: 'lifo' }),
}

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
