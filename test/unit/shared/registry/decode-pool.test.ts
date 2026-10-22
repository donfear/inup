import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { debugLog } from '../../../../src/shared/debug-logger'
import {
  type DecodeWorker,
  decodeOffThread,
  MIN_WORKER_BYTES,
  setDecodeWorkerFactory,
  startDecodeWorker,
} from '../../../../src/shared/registry/decode-pool'
import {
  DECODE_WORKER_MARK,
  type DecodeReply,
  type DecodeRequest,
  decodeRequest,
} from '../../../../src/shared/registry/decode-worker'
import { parseVersions } from '../../../../src/shared/versions'

/** A packument whose JSON is at least `MIN_WORKER_BYTES`, so the pool takes it. */
const bigPackument = (latest = '1.2.0') =>
  JSON.stringify({
    versions: { '1.0.0': {}, [latest]: { engines: { node: '>=20' } } },
    readme: 'x'.repeat(MIN_WORKER_BYTES),
  })

/** An in-process stand-in for a worker thread: answers on a microtask, like a real one would. */
class FakeWorker implements DecodeWorker {
  readonly posted: Array<{ request: DecodeRequest }> = []
  refed = false
  /** When false, requests wait for a test to answer them. */
  answer = true
  private readonly listeners = new Map<string, Array<(value: never) => void>>()

  postMessage(request: DecodeRequest): void {
    this.posted.push({ request })
    if (this.answer) queueMicrotask(() => this.reply(decodeRequest(request)))
  }

  on(event: string, listener: (value: never) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  emit(event: 'message' | 'error' | 'exit', value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never)
  }

  reply(reply: DecodeReply): void {
    this.emit('message', reply)
  }

  ref(): void {
    this.refed = true
  }

  unref(): void {
    this.refed = false
  }
}

/** Pool with fake workers; returns every worker it started. */
const useFakeWorkers = (workers = 3, make: () => FakeWorker = () => new FakeWorker()) => {
  const started: FakeWorker[] = []
  setDecodeWorkerFactory(() => {
    const worker = make()
    started.push(worker)
    return worker
  }, workers)
  return started
}

afterEach(() => {
  setDecodeWorkerFactory(null)
  vi.restoreAllMocks()
})

describe('decodeRequest', () => {
  const json = JSON.stringify({ versions: { '1.0.0': {}, '2.0.0': {} } })

  it('decompresses each encoding and parses the packument like the main thread', () => {
    const bodies: Array<[string, Buffer]> = [
      ['', Buffer.from(json)],
      ['gzip', gzipSync(json)],
      ['br', brotliCompressSync(json)],
      ['deflate', deflateSync(json)],
    ]
    for (const [encoding, raw] of bodies) {
      expect(decodeRequest({ id: 7, raw, encoding })).toEqual({ id: 7, data: parseVersions(json) })
    }
  })

  it('answers with the error when a body cannot be decoded', () => {
    const reply = decodeRequest({ id: 3, raw: Buffer.from('{not json'), encoding: '' })
    expect(reply).toMatchObject({ id: 3, error: expect.stringContaining('SyntaxError') })
  })
})

describe('decodeOffThread', () => {
  it('decodes a big body on a worker, as the main thread would', async () => {
    const started = useFakeWorkers()
    const json = bigPackument()

    await expect(decodeOffThread(Buffer.from(json), '')).resolves.toEqual(parseVersions(json))
    expect(started).toHaveLength(1)
    expect(started[0].posted[0].request.encoding).toBe('')
  })

  it('leaves small bodies to the main thread without starting a worker', () => {
    const started = useFakeWorkers()
    expect(decodeOffThread(Buffer.alloc(MIN_WORKER_BYTES - 1), '')).toBeNull()
    expect(started).toHaveLength(0)
  })

  it('leaves every body to the main thread when there is no core to spare', () => {
    const started = useFakeWorkers(0)
    expect(decodeOffThread(Buffer.from(bigPackument()), '')).toBeNull()
    expect(started).toHaveLength(0)
  })

  it('starts another worker only while every worker has work, up to the limit', async () => {
    const started = useFakeWorkers(2)
    const body = () => Buffer.from(bigPackument())

    const first = decodeOffThread(body(), '')
    const second = decodeOffThread(body(), '')
    const third = decodeOffThread(body(), '')
    await Promise.all([first, second, third])
    expect(started).toHaveLength(2)
    expect(started.map((worker) => worker.posted.length)).toEqual([2, 1])

    // Both idle now: the next body reuses a worker.
    await decodeOffThread(body(), '')
    expect(started).toHaveLength(2)
  })

  it('sends a body to the least busy worker', async () => {
    const started = useFakeWorkers(2, () => Object.assign(new FakeWorker(), { answer: false }))
    const body = () => Buffer.from(bigPackument())

    const queued = [body(), body(), body()].map((raw) => decodeOffThread(raw, ''))
    const [busy, quiet] = started
    expect([busy.posted.length, quiet.posted.length]).toEqual([2, 1])

    quiet.reply(decodeRequest(quiet.posted[0].request))
    const next = decodeOffThread(body(), '')
    expect([busy.posted.length, quiet.posted.length]).toEqual([2, 2])
    quiet.reply(decodeRequest(quiet.posted[1].request))
    await expect(next).resolves.toMatchObject({ latestVersion: '1.2.0' })
    for (const { request } of busy.posted) busy.reply(decodeRequest(request))
    await Promise.all(queued)
  })

  it('keeps the process alive only while a worker has work', async () => {
    const started = useFakeWorkers(1, () => Object.assign(new FakeWorker(), { answer: false }))
    const decoded = decodeOffThread(Buffer.from(bigPackument()), '')
    const [worker] = started
    expect(worker.refed).toBe(true)

    // A reply to nothing it asked for changes nothing.
    worker.reply({ id: 99, error: 'stray' })
    expect(worker.refed).toBe(true)

    worker.reply(decodeRequest(worker.posted[0].request))
    await decoded
    expect(worker.refed).toBe(false)
  })

  it('rejects when the worker could not decode the body', async () => {
    useFakeWorkers()
    const raw = Buffer.from(`{${'x'.repeat(MIN_WORKER_BYTES)}`)
    await expect(decodeOffThread(raw, '')).rejects.toThrow('SyntaxError')
  })

  it.each([
    ['fails', (worker: FakeWorker) => worker.emit('error', new Error('boom')), 'boom'],
    ['exits', (worker: FakeWorker) => worker.emit('exit', 1), 'exited with code 1'],
  ])('gives up on the pool when a worker %s, rejecting its work', async (_, end, message) => {
    const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => undefined)
    const started = useFakeWorkers(1, () => Object.assign(new FakeWorker(), { answer: false }))
    const decoded = decodeOffThread(Buffer.from(bigPackument()), '')

    end(started[0])

    await expect(decoded).rejects.toThrow(message)
    expect(decodeOffThread(Buffer.from(bigPackument()), '')).toBeNull()
    expect(warn).toHaveBeenCalledWith('decode-pool', expect.any(String), expect.any(Error))
  })

  it('decodes on the main thread when no worker can start', () => {
    let calls = 0
    setDecodeWorkerFactory(() => {
      calls++
      return null
    })
    expect(decodeOffThread(Buffer.from(bigPackument()), '')).toBeNull()
    expect(decodeOffThread(Buffer.from(bigPackument()), '')).toBeNull()
    expect(calls).toBe(1)
  })

  it('decodes on the main thread when starting a worker throws', () => {
    const warn = vi.spyOn(debugLog, 'warn').mockImplementation(() => undefined)
    setDecodeWorkerFactory(() => {
      throw new Error('no threads')
    })
    expect(decodeOffThread(Buffer.from(bigPackument()), '')).toBeNull()
    expect(warn).toHaveBeenCalledWith('decode-pool', expect.any(String), expect.any(Error))
  })

  it('keeps the workers it has when one more cannot start', async () => {
    let calls = 0
    const first = new FakeWorker()
    first.answer = false
    setDecodeWorkerFactory(() => (calls++ === 0 ? first : null), 2)

    const a = decodeOffThread(Buffer.from(bigPackument()), '')
    const b = decodeOffThread(Buffer.from(bigPackument()), '')
    expect(calls).toBe(2)
    expect(first.posted).toHaveLength(2)
    for (const { request } of first.posted) first.reply(decodeRequest(request))
    await Promise.all([a, b])
  })

  it('looks for the bundled worker script beside the code', () => {
    setDecodeWorkerFactory(null)
    // Run from source, there is no decode-worker.js beside decode-pool.ts.
    expect(decodeOffThread(Buffer.from(bigPackument()), '')).toBeNull()
  })
})

describe('startDecodeWorker', () => {
  it('returns null when the worker script is missing', () => {
    expect(startDecodeWorker(join(tmpdir(), 'inup-no-such-worker.js'))).toBeNull()
  })

  it('starts the script as a worker that knows it is a decode worker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inup-decode-worker-'))
    try {
      const file = join(dir, 'worker.js')
      writeFileSync(
        file,
        "const { parentPort, workerData } = require('node:worker_threads')\nparentPort.postMessage(workerData)\n"
      )
      const worker = startDecodeWorker(file) as Worker
      const mark = await new Promise((resolve) => worker.once('message', resolve))
      await worker.terminate()
      expect(mark).toBe(DECODE_WORKER_MARK)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
