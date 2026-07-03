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

    expect(Array.from(firstBatch.packages.keys())).toEqual(['next'])
    expect(Array.from(secondBatch.packages.keys())).toEqual(['react'])
    expect(tracker.getProgress()).toMatchObject({
      completed: 0,
      total: 2,
      isRunning: true,
      hasData: false,
    })
  })

  it('skips entries without a name or version', () => {
    const tracker = new BackgroundAuditTracker()

    const added = tracker.enqueue([
      { name: '', version: '^1.0.0' },
      { name: 'left-pad', version: '' },
    ])

    expect(added).toBe(0)
    expect(tracker.reserveNextBatch(20).packageNames).toEqual([])
  })

  it('marks completed packages and does not requeue them', () => {
    const tracker = new BackgroundAuditTracker()

    tracker.enqueue([{ name: 'next', version: '^16.1.6' }])
    const batch = tracker.reserveNextBatch(20)
    tracker.markCompleted(batch.packageNames)

    tracker.enqueue([{ name: 'next', version: '^16.1.6' }])

    expect(tracker.reserveNextBatch(20).packageNames).toEqual([])
    expect(tracker.getProgress()).toMatchObject({
      completed: 1,
      total: 1,
      isRunning: false,
      hasData: true,
    })
  })
})
