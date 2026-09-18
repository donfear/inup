import { describe, expect, it } from 'vitest'
import { SelectionList } from '../../../../src/features/interactive/session/selection-list'
import { makeSelectionState } from '../../../fixtures/selection-state-factory'

const row = (name: string, overrides = {}) => makeSelectionState({ name, ...overrides })
const names = (list: SelectionList) => list.items.map((s) => s.name)

describe('SelectionList', () => {
  it('keeps the initial array as its items so callers holding it see inserts', () => {
    const initial = [row('a')]
    const list = new SelectionList(initial)

    list.insert([row('b')])

    expect(list.items).toBe(initial)
    expect(names(list)).toEqual(['a', 'b'])
    expect(list.length).toBe(2)
  })

  it('places rows at their sorted position whatever order they arrive in', () => {
    const list = new SelectionList()

    list.insert([row('zod')])
    list.insert([row('@scope/late')])
    list.insert([row('axios')])
    list.insert([row('@a/first')])
    list.insert([row('react')])

    expect(names(list)).toEqual(['@a/first', '@scope/late', 'axios', 'react', 'zod'])
    // Arrival order is preserved separately for incremental consumers.
    expect(list.arrivals.map((s) => s.name)).toEqual([
      'zod',
      '@scope/late',
      'axios',
      '@a/first',
      'react',
    ])
  })

  it('keeps rows of the same package in insertion order after the existing ones', () => {
    const list = new SelectionList([row('react', { type: 'dependencies' })])
    const dev = row('react', { type: 'devDependencies' })
    const peer = row('react', { type: 'peerDependencies' })

    list.insert([dev, peer])

    expect(list.items.map((s) => s.type)).toEqual([
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ])
  })

  it('ignores rows whose name, specifier, type, and catalog are already present', () => {
    const list = new SelectionList([row('react', { currentVersionSpecifier: '^18.0.0' })])

    const added = list.insert([
      row('react', { currentVersionSpecifier: '^18.0.0' }),
      row('react', { currentVersionSpecifier: '^17.0.0' }),
      row('react', { currentVersionSpecifier: '^18.0.0', catalog: 'default' }),
    ])

    expect(added.map((s) => s.currentVersionSpecifier)).toEqual(['^17.0.0', '^18.0.0'])
    expect(list.length).toBe(3)
  })

  it('bumps the revision only when something was actually added', () => {
    const list = new SelectionList([row('a')])
    expect(list.revision).toBe(0)

    list.insert([row('a')])
    expect(list.revision).toBe(0)

    list.insert([row('b'), row('c')])
    expect(list.revision).toBe(1)
  })

  it('inserts 10k rows in random order into a fully sorted list', () => {
    const list = new SelectionList()
    const all = Array.from({ length: 10_000 }, (_, i) =>
      row(`${i % 7 === 0 ? '@s/' : ''}pkg-${String(i).padStart(5, '0')}`)
    )
    for (let i = all.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1)
      ;[all[i], all[j]] = [all[j], all[i]]
    }

    for (const state of all) list.insert([state])

    const sorted = names(list)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]
      const b = sorted[i]
      const aScoped = a.startsWith('@')
      const bScoped = b.startsWith('@')
      if (aScoped !== bScoped) expect(aScoped).toBe(true)
      else expect(a.localeCompare(b)).toBeLessThanOrEqual(0)
    }
  })
})
