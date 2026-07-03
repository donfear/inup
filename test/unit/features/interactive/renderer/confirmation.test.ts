import { describe, expect, it } from 'vitest'
import { renderConfirmation } from '../../../../../src/features/interactive/renderer/confirmation'
import { stripAnsi } from '../../../../../src/shared/terminal/text'

function makeChoice(overrides?: Record<string, unknown>) {
  return {
    name: 'demo-pkg',
    targetVersion: '2.0.0',
    upgradeType: 'latest',
    currentVersionSpecifier: '^1.0.0',
    packageJsonPath: '/repo/package.json',
    ...overrides,
  }
}

describe('renderConfirmation', () => {
  it('renders a warning when nothing is selected', () => {
    expect(stripAnsi(renderConfirmation([]))).toBe('No packages selected for upgrade.')
  })

  it('lists each package with its target version and upgrade type', () => {
    const output = stripAnsi(
      renderConfirmation([
        makeChoice(),
        makeChoice({ name: 'other-pkg', targetVersion: '1.1.0', upgradeType: 'range' }),
      ])
    )

    expect(output).toContain('Ready to upgrade 2 package(s)')
    expect(output).toContain('demo-pkg → 2.0.0 (latest)')
    expect(output).toContain('other-pkg → 1.1.0 (range)')
  })

  it('groups duplicate package names and shows the instance count', () => {
    const output = stripAnsi(
      renderConfirmation([
        makeChoice({ packageJsonPath: '/repo/a/package.json' }),
        makeChoice({ packageJsonPath: '/repo/b/package.json' }),
      ])
    )

    expect(output).toContain('Ready to upgrade 1 package(s)')
    expect(output).toContain('(2 instances)')
  })

  it('does not show an instance count for a single occurrence', () => {
    expect(stripAnsi(renderConfirmation([makeChoice()]))).not.toContain('instances')
  })

  it('always shows the key hint footer', () => {
    const output = stripAnsi(renderConfirmation([makeChoice()]))

    expect(output).toContain('Press Enter/Y to proceed, N to go back to selection, ESC to cancel')
  })
})
