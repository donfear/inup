import { describe, expect, it } from 'vitest'
import { ModalManager } from '../../../src/ui/state/modal-manager'

describe('ModalManager', () => {
  it('clamps stale info modal scroll offsets when content shrinks', () => {
    const manager = new ModalManager()

    manager.toggleInfoModal(0)
    manager.scrollModalDown(5)
    manager.scrollModalDown(5)
    manager.scrollModalDown(5)

    expect(manager.getScrollOffset()).toBe(3)
    expect(manager.clampScrollOffset(0)).toBe(true)
    expect(manager.getScrollOffset()).toBe(0)
  })
})
