import { describe, expect, it } from 'vitest'
import { ModalManager } from '../../../../src/features/interactive/state/modal-manager'

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

  it('opens the info modal for the current row and bumps the session id', () => {
    const manager = new ModalManager()

    const sessionId = manager.toggleInfoModal(3)

    expect(manager.isModalOpen()).toBe(true)
    expect(manager.getModalRow()).toBe(3)
    expect(manager.getSessionId()).toBe(sessionId)
    expect(manager.getInfoModalTab()).toBe('info')
    expect(manager.isLoading()).toBe(false)
  })

  it('closes the info modal on a second toggle and resets its state', () => {
    const manager = new ModalManager()

    const openId = manager.toggleInfoModal(3)
    manager.scrollModalDown(5)
    const closeId = manager.toggleInfoModal(3)

    expect(closeId).toBeGreaterThan(openId)
    expect(manager.isModalOpen()).toBe(false)
    expect(manager.getModalRow()).toBe(-1)
    expect(manager.getScrollOffset()).toBe(0)
    expect(manager.getInfoModalTab()).toBe('info')
  })

  it('resets the scroll when switching tabs, but not for the same tab', () => {
    const manager = new ModalManager()
    manager.toggleInfoModal(0)
    manager.scrollModalDown(5)

    expect(manager.setInfoModalTab('info')).toBe(false)
    expect(manager.getScrollOffset()).toBe(1)

    expect(manager.setInfoModalTab('usedBy')).toBe(true)
    expect(manager.getInfoModalTab()).toBe('usedBy')
    expect(manager.getScrollOffset()).toBe(0)
  })

  it('applies loading updates without a session id unconditionally', () => {
    const manager = new ModalManager()
    manager.toggleInfoModal(0)

    expect(manager.setModalLoading(true)).toBe(true)
    expect(manager.isLoading()).toBe(true)
  })

  it('stops info modal scrolling at both boundaries', () => {
    const manager = new ModalManager()
    manager.toggleInfoModal(0)

    expect(manager.scrollModalUp()).toBe(false)

    expect(manager.scrollModalDown(2)).toBe(true)
    expect(manager.scrollModalDown(2)).toBe(true)
    expect(manager.scrollModalDown(2)).toBe(false)
    expect(manager.getScrollOffset()).toBe(2)

    expect(manager.scrollModalUp()).toBe(true)
    expect(manager.getScrollOffset()).toBe(1)

    manager.resetScroll()
    expect(manager.getScrollOffset()).toBe(0)
  })

  it('reports an unchanged clamp as false', () => {
    const manager = new ModalManager()
    manager.toggleInfoModal(0)

    expect(manager.clampScrollOffset(5)).toBe(false)
  })

  it('toggles and scrolls the debug modal within bounds', () => {
    const manager = new ModalManager()

    manager.toggleDebugModal()
    expect(manager.isDebugModalOpen()).toBe(true)

    expect(manager.scrollDebugModalUp()).toBe(false)
    expect(manager.scrollDebugModalDown(1)).toBe(true)
    expect(manager.scrollDebugModalDown(1)).toBe(false)
    expect(manager.scrollDebugModalUp()).toBe(true)

    manager.scrollDebugModalDown(5)
    manager.toggleDebugModal()
    expect(manager.isDebugModalOpen()).toBe(false)
    expect(manager.getState().debugModalScrollOffset).toBe(0)
  })

  it('clamps the debug modal scroll when content shrinks', () => {
    const manager = new ModalManager()
    manager.toggleDebugModal()
    manager.scrollDebugModalDown(10)
    manager.scrollDebugModalDown(10)

    expect(manager.clampDebugModalScrollOffset(1)).toBe(true)
    expect(manager.getState().debugModalScrollOffset).toBe(1)
    expect(manager.clampDebugModalScrollOffset(1)).toBe(false)
  })

  it('closes the debug modal explicitly', () => {
    const manager = new ModalManager()
    manager.toggleDebugModal()
    manager.scrollDebugModalDown(5)

    manager.closeDebugModal()

    expect(manager.isDebugModalOpen()).toBe(false)
    expect(manager.getState().debugModalScrollOffset).toBe(0)
  })

  it('scrolls and clamps the help modal within bounds', () => {
    const manager = new ModalManager()
    manager.toggleHelpModal()

    expect(manager.scrollHelpModalUp()).toBe(false)
    expect(manager.scrollHelpModalDown(1)).toBe(true)
    expect(manager.scrollHelpModalDown(1)).toBe(false)
    expect(manager.scrollHelpModalUp()).toBe(true)

    manager.scrollHelpModalDown(10)
    manager.scrollHelpModalDown(10)
    expect(manager.clampHelpModalScrollOffset(1)).toBe(true)
    expect(manager.getState().helpModalScrollOffset).toBe(1)
    expect(manager.clampHelpModalScrollOffset(1)).toBe(false)
  })

  it('returns a defensive copy of its state', () => {
    const manager = new ModalManager()

    const state = manager.getState()
    state.showInfoModal = true

    expect(manager.isModalOpen()).toBe(false)
  })
})
