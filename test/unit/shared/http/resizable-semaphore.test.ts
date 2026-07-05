import { describe, expect, it } from 'vitest'
import { ResizableSemaphore } from '../../../../src/shared/http/resizable-semaphore'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('ResizableSemaphore', () => {
  it('admits up to the limit immediately, then queues', async () => {
    const sem = new ResizableSemaphore(2)
    await sem.acquire()
    await sem.acquire()
    expect(sem.getInFlight()).toBe(2)

    let third = false
    const p = sem.acquire().then(() => {
      third = true
    })
    await tick()
    expect(third).toBe(false)
    expect(sem.getWaiterCount()).toBe(1)

    sem.release()
    await p
    expect(third).toBe(true)
    expect(sem.getInFlight()).toBe(2)
  })

  it('never exceeds the limit at the moment of admission', async () => {
    const sem = new ResizableSemaphore(3)
    let peak = 0
    let inFlight = 0
    const work = async () => {
      await sem.acquire()
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick()
      inFlight--
      sem.release()
    }
    await Promise.all(Array.from({ length: 20 }, work))
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('growing the limit dispatches more queued waiters', async () => {
    const sem = new ResizableSemaphore(1)
    await sem.acquire()

    const woken: number[] = []
    void sem.acquire().then(() => woken.push(1))
    void sem.acquire().then(() => woken.push(2))
    await tick()
    expect(woken).toEqual([]) // both queued behind the single slot

    sem.setLimit(3) // open 2 more slots (1 in-flight, limit now 3)
    await tick()
    expect(woken).toEqual([1, 2])
    expect(sem.getInFlight()).toBe(3)
  })

  it('shrinking never aborts in-flight holders and stops new admission', async () => {
    const sem = new ResizableSemaphore(4)
    await sem.acquire()
    await sem.acquire()
    await sem.acquire()
    await sem.acquire()
    expect(sem.getInFlight()).toBe(4)

    let admitted = false
    void sem.acquire().then(() => {
      admitted = true
    })

    // Shrink below current in-flight. The 4 holders keep running.
    sem.setLimit(2)
    await tick()
    expect(sem.getInFlight()).toBe(4) // not aborted
    expect(admitted).toBe(false) // new waiter blocked

    // Releases must drain in-flight below the new limit before admitting.
    sem.release() // 3
    await tick()
    expect(admitted).toBe(false)
    sem.release() // 2
    await tick()
    expect(admitted).toBe(false) // still at limit (2), waiter not admitted
    sem.release() // 1 → headroom for the waiter
    await tick()
    expect(admitted).toBe(true)
  })

  it('guarded release does not over-admit after a shrink', async () => {
    const sem = new ResizableSemaphore(5)
    for (let i = 0; i < 5; i++) await sem.acquire()

    const order: number[] = []
    for (let i = 0; i < 3; i++) {
      const id = i
      void sem.acquire().then(() => order.push(id))
    }

    sem.setLimit(1)
    // Release all 5. With a naive (unguarded) release each would wake a waiter,
    // over-admitting past limit 1. Guarded release must admit at most enough to
    // reach the limit as in-flight drains.
    for (let i = 0; i < 5; i++) sem.release()
    await tick()
    await tick()

    // in-flight must never exceed the new limit of 1 among the woken waiters.
    expect(sem.getInFlight()).toBeLessThanOrEqual(1)
  })
})

describe('inspection helpers', () => {
  it('exposes the current limit and in-flight count', async () => {
    const { ResizableSemaphore } = await import('../../../../src/shared/http/resizable-semaphore')
    const semaphore = new ResizableSemaphore(2)

    expect(semaphore.getLimit()).toBe(2)
    expect(semaphore.getInFlight()).toBe(0)

    await semaphore.acquire()
    expect(semaphore.getInFlight()).toBe(1)
    semaphore.release()
    expect(semaphore.getInFlight()).toBe(0)
  })

  it('clamps a fractional or non-positive initial limit to at least one', async () => {
    const { ResizableSemaphore } = await import('../../../../src/shared/http/resizable-semaphore')

    expect(new ResizableSemaphore(0).getLimit()).toBe(1)
    expect(new ResizableSemaphore(2.9).getLimit()).toBe(2)
  })
})
