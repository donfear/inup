/**
 * A counting semaphore whose limit can change at runtime.
 *
 * - `acquire()` resolves immediately if there is headroom, otherwise queues a
 *   waiter (FIFO) until a `release()` opens a slot.
 * - `setLimit()` may grow or shrink the limit at any time. Growing wakes as many
 *   queued waiters as the new headroom allows. Shrinking never aborts in-flight
 *   holders — it simply stops admitting new ones until natural releases drain
 *   `inFlight` back below the new limit.
 * - `release()` is guarded: it only wakes a waiter when `inFlight < limit`. This
 *   is what makes a shrink actually take effect (an unconditional wake would
 *   re-admit immediately and ignore the smaller limit).
 *
 * Invariant: `inFlight` never exceeds `limit` at the moment of admission. A prior
 * shrink can leave `inFlight > limit` transiently; no new holder is admitted
 * until it drains.
 */
export class ResizableSemaphore {
  private limit: number
  private inFlight = 0
  private readonly waiters: Array<() => void> = []

  constructor(initialLimit: number) {
    this.limit = Math.max(1, Math.floor(initialLimit))
  }

  getLimit(): number {
    return this.limit
  }

  getInFlight(): number {
    return this.inFlight
  }

  getWaiterCount(): number {
    return this.waiters.length
  }

  setLimit(next: number): void {
    this.limit = Math.max(1, Math.floor(next))
    // Growing may have opened headroom for queued waiters.
    this.drainWaiters()
  }

  async acquire(): Promise<void> {
    // `inFlight` is the single authoritative counter and is incremented exactly
    // once per admission, synchronously at the moment admission is decided —
    // either here (fast path) or in `drainWaiters` (when a slot frees up). A
    // woken waiter must NOT increment again, or a concurrent fast-path acquire
    // reading a stale count could over-admit past the limit.
    if (this.inFlight < this.limit) {
      this.inFlight++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  release(): void {
    this.inFlight--
    this.drainWaiters()
  }

  /**
   * Wakes queued waiters while there is headroom, incrementing `inFlight` for
   * each as it is admitted so the count stays authoritative and synchronous.
   */
  private drainWaiters(): void {
    while (this.inFlight < this.limit && this.waiters.length > 0) {
      const next = this.waiters.shift()!
      this.inFlight++
      next()
    }
  }
}
