import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SortedReveal } from '../../../../src/features/interactive/session/sorted-reveal'

/** A reveal whose items are the package names themselves, recording each batch it releases. */
const recordingReveal = () => {
  const batches: string[][] = []
  const reveal = new SortedReveal<string>((items) => batches.push(items))
  const arrive = (...names: string[]) => {
    for (const name of names) reveal.arrive(name, name)
  }
  return { reveal, arrive, batches }
}

describe('SortedReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals each package at once when packages arrive in list order', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'zod'])

    arrive('axios', 'react', 'zod')

    expect(batches).toEqual([['axios'], ['react'], ['zod']])
  })

  it('holds a package until every package listed above it has arrived, then reveals them in list order', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'zod'])

    arrive('zod', 'react')
    expect(batches).toEqual([])

    arrive('axios')
    expect(batches).toEqual([['axios', 'react', 'zod']])
  })

  it('orders the list the way the picker does: scoped packages first, then by name', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['zod', 'axios', '@types/node'])

    arrive('@types/node')
    arrive('zod')
    arrive('axios')

    expect(batches).toEqual([['@types/node'], ['axios', 'zod']])
  })

  it('reveals a held package once it has waited 300 ms, even while one above it is still loading', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'zod'])

    arrive('zod')
    vi.advanceTimersByTime(299)
    expect(batches).toEqual([])

    vi.advanceTimersByTime(1)
    expect(batches).toEqual([['zod']])

    // The late arrivals still go in list order, and zod is not revealed twice.
    arrive('react')
    arrive('axios')
    expect(batches).toEqual([['zod'], ['axios', 'react']])
  })

  it('gives each held package its own full wait', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'vue', 'zod'])

    arrive('vue')
    vi.advanceTimersByTime(100)
    arrive('zod')
    vi.advanceTimersByTime(200)
    expect(batches).toEqual([['vue']])

    vi.advanceTimersByTime(99)
    expect(batches).toEqual([['vue']])

    vi.advanceTimersByTime(1)
    expect(batches).toEqual([['vue'], ['zod']])
  })

  it('releases packages whose wait ends together in one batch', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'zod'])

    arrive('zod', 'react')
    vi.advanceTimersByTime(300)

    expect(batches).toEqual([['zod', 'react']])
  })

  it('does not reveal a package again when its wait ends after the packages above it arrived', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'zod'])

    arrive('zod')
    vi.advanceTimersByTime(100)
    arrive('react', 'axios')
    vi.advanceTimersByTime(1000)

    expect(batches).toEqual([['axios', 'react', 'zod']])
  })

  it('reveals at once a package that arrives before the list is known', () => {
    const { arrive, batches } = recordingReveal()

    arrive('zod')

    expect(batches).toEqual([['zod']])
  })

  it('reveals at once a package that is not on the list', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react'])

    arrive('zod')

    expect(batches).toEqual([['zod']])
  })

  it('flush reveals every held package in one batch and stops holding', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'react', 'vue', 'zod'])
    arrive('zod', 'vue')

    reveal.flush()
    expect(batches).toEqual([['zod', 'vue']])

    // axios never arrived, yet react is not held after a flush.
    arrive('react')
    expect(batches).toEqual([['zod', 'vue'], ['react']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flush with nothing held reveals nothing', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios'])
    arrive('axios')

    reveal.flush()

    expect(batches).toEqual([['axios']])
  })

  it('never asks for a negative wait when the next package is already due', () => {
    vi.useRealTimers()
    const timers: Array<{ fire: () => void; delay: number }> = []
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fire: () => void,
      delay: number
    ) => {
      timers.push({ fire, delay })
      return timers.length as unknown as NodeJS.Timeout
    }) as typeof setTimeout)
    // Time moves on between reading the clock and setting the next timer, as it does when
    // the event loop is busy.
    const nowSpy = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0) // zod arrives: due at 300
      .mockReturnValueOnce(0) // its timer
      .mockReturnValueOnce(0.6) // vue arrives: due at 300.6
      .mockReturnValueOnce(300.5) // zod's timer fires: vue is not due yet
      .mockReturnValueOnce(300.7) // the timer for vue is set a moment later
    try {
      const { reveal, arrive, batches } = recordingReveal()
      reveal.expect(['axios', 'vue', 'zod'])
      arrive('zod', 'vue')

      timers[0].fire()

      expect(batches).toEqual([['zod']])
      expect(timers.map((timer) => timer.delay)).toEqual([300, 0])
    } finally {
      setTimeoutSpy.mockRestore()
      nowSpy.mockRestore()
    }
  })

  it('dispose drops held packages without revealing them', () => {
    const { reveal, arrive, batches } = recordingReveal()
    reveal.expect(['axios', 'zod'])
    arrive('zod')

    reveal.dispose()
    vi.advanceTimersByTime(1000)

    expect(batches).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
