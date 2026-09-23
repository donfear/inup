import { describe, expect, it } from 'vitest'
import { BackgroundAuditTracker } from '../../../../src/features/audit/background-audit'

describe('BackgroundAuditTracker', () => {
  it('queues unique packages once and reserves them in batches', () => {
    const tracker = new BackgroundAuditTracker()

    tracker.enqueue([
      { name: 'next', version: '^16.1.6' },
      { name: 'react', version: '^19.0.0' },
      { name: 'next', version: '^16.1.6' },
    ])

    const firstBatch = tracker.reserveNextBatch(1)
    const secondBatch = tracker.reserveNextBatch(5)

    expect(firstBatch.packages).toEqual([{ name: 'next', version: '^16.1.6' }])
    expect(secondBatch.packages).toEqual([{ name: 'react', version: '^19.0.0' }])
    expect(tracker.getProgress()).toMatchObject({
      completed: 0,
      total: 2,
      failed: 0,
      isRunning: true,
      hasData: false,
    })
  })

  it('queues each declared version of a package separately', () => {
    const tracker = new BackgroundAuditTracker()

    const added = tracker.enqueue([
      { name: 'lodash', version: '^3.10.1' },
      { name: 'lodash', version: '^4.17.21' },
    ])

    expect(added).toBe(2)
    expect(tracker.reserveNextBatch(20).keys).toEqual(['lodash@^3.10.1', 'lodash@^4.17.21'])
  })

  it('skips entries without a name or version', () => {
    const tracker = new BackgroundAuditTracker()

    const added = tracker.enqueue([
      { name: '', version: '^1.0.0' },
      { name: 'left-pad', version: '' },
    ])

    expect(added).toBe(0)
    expect(tracker.reserveNextBatch(20).keys).toEqual([])
  })

  it('marks completed packages and does not requeue them', () => {
    const tracker = new BackgroundAuditTracker()

    tracker.enqueue([{ name: 'next', version: '^16.1.6' }])
    const batch = tracker.reserveNextBatch(20)
    tracker.markCompleted(batch.keys)

    tracker.enqueue([{ name: 'next', version: '^16.1.6' }])

    expect(tracker.reserveNextBatch(20).keys).toEqual([])
    expect(tracker.getProgress()).toMatchObject({
      completed: 1,
      total: 1,
      failed: 0,
      isRunning: false,
      hasData: true,
    })
  })

  it('counts failed packages as done without data, and queues them again on request', () => {
    const tracker = new BackgroundAuditTracker()

    tracker.enqueue([{ name: 'next', version: '^16.1.6' }])
    tracker.markFailed(tracker.reserveNextBatch(20).keys)

    expect(tracker.getProgress()).toEqual({
      completed: 1,
      total: 1,
      failed: 1,
      isRunning: false,
      hasData: false,
    })

    // A failure is not a result: enqueueing the same version retries it.
    expect(tracker.enqueue([{ name: 'next', version: '^16.1.6' }])).toBe(1)
    expect(tracker.getProgress()).toMatchObject({ completed: 0, total: 1, failed: 0 })
    tracker.markCompleted(tracker.reserveNextBatch(20).keys)
    expect(tracker.getProgress()).toMatchObject({ completed: 1, failed: 0, hasData: true })
  })
})
