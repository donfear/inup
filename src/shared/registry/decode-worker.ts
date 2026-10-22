import { parentPort, workerData } from 'node:worker_threads'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { type ParsedVersions, parseVersions } from '../versions'

/** A registry body for a decode worker; `id` pairs the reply with the request. */
export interface DecodeRequest {
  id: number
  raw: Uint8Array
  /** Lower-cased content-encoding; '' when absent. */
  encoding: string
}

export type DecodeReply = { id: number; data: ParsedVersions } | { id: number; error: string }

/** Decompress and parse one body, as the main thread's TypeScript path does. */
export function decodeRequest({ id, raw, encoding }: DecodeRequest): DecodeReply {
  try {
    const buffer = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
    const body =
      encoding === 'gzip'
        ? gunzipSync(buffer)
        : encoding === 'br'
          ? brotliDecompressSync(buffer)
          : encoding === 'deflate'
            ? inflateSync(buffer)
            : buffer
    return { id, data: parseVersions(body.toString('utf8')) }
  } catch (error) {
    return { id, error: String(error) }
  }
}

/** `workerData` of a decode worker, so the module only answers when decode-pool.ts started it. */
export const DECODE_WORKER_MARK = 'inup-decode-worker'

// Started as a worker by decode-pool.ts: answer each request in turn.
/* v8 ignore next 5 */
if (workerData === DECODE_WORKER_MARK) {
  parentPort?.on('message', (request: DecodeRequest) => {
    parentPort?.postMessage(decodeRequest(request))
  })
}
