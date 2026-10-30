import { comparePackageNames } from '../../../shared/package-names'

/** How long a package that resolved early waits for the ones listed above it. */
const REVEAL_HOLD_MS = 300

interface Held<T> {
  item: T
  due: number
}

/**
 * Lets the picker fill in from the top while registry lookups finish in any order.
 *
 * A package is revealed once every package listed above it has arrived, so a fast lookup
 * no longer lands mid-list and pushes the rows below it down. None waits for long: a package
 * still held after `REVEAL_HOLD_MS` is revealed anyway, and the rows find their sorted place
 * in the list either way. Holding changes when rows appear, never where.
 *
 * The last arrival completes the list, so the picker is full at the same moment as without
 * holding.
 */
export class SortedReveal<T> {
  private order: string[] | null = null
  private listed = new Set<string>()
  private next = 0
  private readonly arrived = new Set<string>()
  /** In arrival order, which is also the order their waits end in. */
  private readonly held = new Map<string, Held<T>>()
  private timer: ReturnType<typeof setTimeout> | undefined

  /** @param reveal Receives each batch of packages to show, in the order to show them. */
  constructor(private readonly reveal: (items: T[]) => void) {}

  /** Every package that will arrive. Until this is known, packages are revealed as they come. */
  expect(names: Iterable<string>): void {
    this.order = [...names].sort(comparePackageNames)
    this.listed = new Set(this.order)
  }

  /** One package arrived. Called once per package. */
  arrive(name: string, item: T): void {
    if (this.order === null || !this.listed.has(name)) {
      this.reveal([item])
      return
    }
    this.arrived.add(name)
    this.held.set(name, { item, due: performance.now() + REVEAL_HOLD_MS })
    this.releaseListedPrefix(this.order)
    this.scheduleRelease()
  }

  /** Every package has arrived or never will: reveal what is held and stop holding. */
  flush(): void {
    const items = [...this.held.values()].map((held) => held.item)
    this.dispose()
    if (items.length > 0) this.reveal(items)
  }

  /** Drop what is held without revealing it, and stop holding. */
  dispose(): void {
    this.order = null
    this.held.clear()
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private releaseListedPrefix(order: string[]): void {
    const items: T[] = []
    while (this.next < order.length && this.arrived.has(order[this.next])) {
      const name = order[this.next++]
      const held = this.held.get(name)
      if (held) {
        items.push(held.item)
        this.held.delete(name)
      }
    }
    if (items.length > 0) this.reveal(items)
  }

  /** One timer, for the package held longest; it re-arms for the next when it fires. */
  private scheduleRelease(): void {
    if (this.timer !== undefined) return
    const oldest = this.held.values().next()
    if (oldest.done) return
    // Already due by the time it is set when the event loop ran late; Node warns on stderr,
    // over the picker, about a negative delay.
    const delay = Math.max(0, oldest.value.due - performance.now())
    this.timer = setTimeout(() => this.releaseDue(), delay)
  }

  private releaseDue(): void {
    this.timer = undefined
    const now = performance.now()
    const items: T[] = []
    for (const [name, held] of this.held) {
      if (held.due > now) break
      items.push(held.item)
      this.held.delete(name)
    }
    if (items.length > 0) this.reveal(items)
    this.scheduleRelease()
  }
}
