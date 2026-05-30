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

  it('ignores stale loading updates from an older modal session', () => {
    const manager = new ModalManager()

    const firstSessionId = manager.toggleInfoModal(0)
    expect(manager.setModalLoading(true, firstSessionId)).toBe(true)

    manager.closeInfoModal()
    const secondSessionId = manager.toggleInfoModal(1)

    expect(secondSessionId).toBeGreaterThan(firstSessionId)
    expect(manager.setModalLoading(false, firstSessionId)).toBe(false)
    expect(manager.isLoading()).toBe(false)

    expect(manager.setModalLoading(true, secondSessionId)).toBe(true)
    expect(manager.isLoading()).toBe(true)
  })

  it('toggles the help overlay independently', () => {
    const manager = new ModalManager()

    expect(manager.isHelpModalOpen()).toBe(false)
    manager.toggleHelpModal()
    expect(manager.isHelpModalOpen()).toBe(true)
    expect(manager.getState().showHelpModal).toBe(true)

    manager.closeHelpModal()
    expect(manager.isHelpModalOpen()).toBe(false)
  })
})
