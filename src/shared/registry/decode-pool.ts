import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { debugLog } from '../debug-logger'
import type { ParsedVersions } from '../versions'
import { DECODE_WORKER_MARK, type DecodeReply, type DecodeRequest } from './decode-worker'

/**
 * Worker threads that decompress and parse big registry bodies off the main
 * thread. On a fast link a cold run is bound by the main thread: JSON.parse of
 * megabyte packuments queues up behind the network, and every response waits
 * its turn. Spread over the other cores, parsing keeps pace with the downloads.
 *
 * Small bodies stay on the main thread — handing one over costs more than
 * parsing it — and a run that never meets a big one starts no worker at all.
 * Workers start on demand, up to one per spare core, and keep the process
 * alive only while they have work. Anything that goes wrong (no worker script
 * beside this module, a worker that fails or exits) leaves the body to the
 * main thread, as if there were no pool.
 */

/** Compressed bodies below this size decode on the main thread. */
export const MIN_WORKER_BYTES = 32 * 1024

/** More workers than this stop paying off: the main thread has to keep them fed. */
const MAX_WORKERS = 3

/** What the pool needs from a worker thread; tests substitute their own. */
export interface DecodeWorker {
  postMessage(request: DecodeRequest): void
  on(event: 'message', listener: (reply: DecodeReply) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  ref(): void
  unref(): void
}

export type DecodeWorkerFactory = () => DecodeWorker | null

// Built beside this module: by tsc into dist/shared/registry, and beside the CLI bundle in dist.
const WORKER_FILE = join(__dirname, 'decode-worker.js')

/** A decode worker running `file`, or null when there is none (a run from source). */
export function startDecodeWorker(file: string = WORKER_FILE): DecodeWorker | null {
  if (!existsSync(file)) return null
  return new Worker(file, { workerData: DECODE_WORKER_MARK })
}

const startWorker: DecodeWorkerFactory = () => startDecodeWorker()

interface Slot {
  worker: DecodeWorker
  pending: Map<number, { resolve: (data: ParsedVersions) => void; reject: (e: Error) => void }>
}

let factory: DecodeWorkerFactory = startWorker
let maxWorkers = Math.min(MAX_WORKERS, availableParallelism() - 1)
let slots: Slot[] = []
let nextId = 0
// Set once a worker could not start or failed: the rest of the run decodes on the main thread.
let disabled = false

/**
 * Decode `raw` on a worker thread, or null when the body should be decoded on
 * the main thread instead (small, no pool, or the pool gave up). The promise
 * rejects only if the worker failed before answering; the caller then decodes
 * the body itself.
 */
export function decodeOffThread(raw: Buffer, encoding: string): Promise<ParsedVersions> | null {
  if (disabled || raw.length < MIN_WORKER_BYTES || maxWorkers < 1) return null
  const slot = pickSlot()
  if (!slot) return null
  const id = nextId++
  return new Promise<ParsedVersions>((resolve, reject) => {
    if (slot.pending.size === 0) slot.worker.ref()
    slot.pending.set(id, { resolve, reject })
    // Copied, not transferred: the caller keeps the body to decode itself if the worker fails.
    const request: DecodeRequest = { id, raw, encoding }
    slot.worker.postMessage(request)
  })
}

/** The least busy worker, starting another while every one has work queued. */
function pickSlot(): Slot | null {
  let best: Slot | null = null
  for (const slot of slots) {
    if (!best || slot.pending.size < best.pending.size) best = slot
  }
  if ((!best || best.pending.size > 0) && slots.length < maxWorkers) {
    const started = addSlot()
    if (started) return started
  }
  return best
}

function addSlot(): Slot | null {
  let worker: DecodeWorker | null
  try {
    worker = factory()
  } catch (error) {
    debugLog.warn('decode-pool', 'could not start a decode worker', error)
    worker = null
  }
  if (!worker) {
    // No worker script (a test run from source) or no threads: never try again.
    if (slots.length === 0) disabled = true
    return null
  }
  const slot: Slot = { worker, pending: new Map() }
  worker.unref()
  worker.on('message', (reply) => {
    const task = slot.pending.get(reply.id)
    if (!task) return
    slot.pending.delete(reply.id)
    if (slot.pending.size === 0) worker.unref()
    if ('data' in reply) task.resolve(reply.data)
    else task.reject(new Error(reply.error))
  })
  const fail = (error: Error) => {
    debugLog.warn('decode-pool', 'decode worker failed, decoding on the main thread', error)
    disabled = true
    slots = slots.filter((other) => other !== slot)
    for (const task of slot.pending.values()) task.reject(error)
    slot.pending.clear()
  }
  worker.on('error', fail)
  worker.on('exit', (code) => fail(new Error(`decode worker exited with code ${code}`)))
  slots.push(slot)
  return slot
}

/** Test hook: swap the worker factory and pool size, and forget every worker. */
export function setDecodeWorkerFactory(
  next: DecodeWorkerFactory | null,
  workers: number = MAX_WORKERS
): void {
  factory = next ?? startWorker
  maxWorkers = workers
  slots = []
  nextId = 0
  disabled = false
}
