import type { PackageSelectionState } from '../../../shared/types'
import { comparePackageNames, selectionKey } from './selection-state-builder'

const keyOf = (state: PackageSelectionState) =>
  selectionKey(state.name, state.currentVersionSpecifier, state.type, state.catalog)

/**
 * The rows of one interactive session.
 *
 * `items` is the array every consumer (renderer, filters, dispatcher) reads:
 * always sorted scoped-first then by name, rows of the same name in insertion
 * order. `insert` places new rows at their sorted position no matter when they
 * resolve, so a slow registry response never holds the list back and a fast
 * one never lands out of place.
 *
 * `arrivals` is the same rows in arrival order and only ever grows, which lets
 * layout caches measure just what is new. `revision` changes on every insert
 * that added a row, so a cursor can detect that indexes shifted.
 */
export class SelectionList {
  readonly items: PackageSelectionState[]
  readonly arrivals: PackageSelectionState[]
  private readonly keys = new Set<string>()
  private revisionCounter = 0

  /** Takes ownership of `initial` (already sorted by the state builders). */
  constructor(initial: PackageSelectionState[] = []) {
    this.items = initial
    this.arrivals = [...initial]
    for (const state of initial) this.keys.add(keyOf(state))
  }

  get revision(): number {
    return this.revisionCounter
  }

  get length(): number {
    return this.items.length
  }

  /** Inserts rows not already present and returns those that were added. */
  insert(states: PackageSelectionState[]): PackageSelectionState[] {
    const inserted: PackageSelectionState[] = []
    for (const state of states) {
      const key = keyOf(state)
      if (this.keys.has(key)) continue
      this.keys.add(key)
      this.items.splice(this.positionFor(state), 0, state)
      this.arrivals.push(state)
      inserted.push(state)
    }
    if (inserted.length > 0) this.revisionCounter++
    return inserted
  }

  /** Index after every row that sorts at or before `state` (stable for equal names). */
  private positionFor(state: PackageSelectionState): number {
    let low = 0
    let high = this.items.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (comparePackageNames(this.items[mid].name, state.name) <= 0) low = mid + 1
      else high = mid
    }
    return low
  }
}
