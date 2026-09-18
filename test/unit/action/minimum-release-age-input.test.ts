import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Action validates `minimum-release-age` in shell, before inup ever runs, so a typo'd
 * window fails the job instead of silently disabling the guard — the precise failure this
 * feature exists to prevent, one layer up.
 *
 * The snippet is extracted from action.yml rather than retyped here: a copy would keep
 * passing after the real one drifted.
 */
const actionYml = readFileSync(join(process.cwd(), 'action.yml'), 'utf8')

function extractValidation(): string {
  const start = actionYml.indexOf('case "$MINIMUM_RELEASE_AGE" in')
  expect(start, 'action.yml no longer validates MINIMUM_RELEASE_AGE').toBeGreaterThan(-1)
  const end = actionYml.indexOf('esac', start)
  const block = actionYml.slice(start, end + 'esac'.length)
  // The step body is indented inside the YAML block scalar; bash does not care, but
  // dedenting keeps a failure message readable.
  return block
    .split('\n')
    .map((line) => line.replace(/^ {8}/, ''))
    .join('\n')
}

const bashAvailable = spawnSync('bash', ['-c', 'exit 0']).status === 0

const runValidation = (value: string) =>
  spawnSync('bash', ['-c', `set -euo pipefail\n${extractValidation()}\necho ACCEPTED`], {
    env: { ...process.env, MINIMUM_RELEASE_AGE: value },
    encoding: 'utf8',
  })

describe.skipIf(!bashAvailable)('action.yml minimum-release-age validation', () => {
  it.each(['10080', '0', '1', '525600', ''])('accepts %o', (value) => {
    const result = runValidation(value)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('ACCEPTED')
  })

  it.each(['abc', '7.5', '-1', '10080 ', '1e5', '0x10', '7d'])(
    'fails the job on %o rather than running without a cooldown',
    (value) => {
      const result = runValidation(value)
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toContain('invalid minimum-release-age')
    }
  )

  it('names the offending value and the accepted form in the error', () => {
    const result = runValidation('7 days')
    expect(result.stdout + result.stderr).toContain("'7 days' is not valid")
    expect(result.stdout + result.stderr).toContain('whole number of minutes')
  })
})

describe('action.yml wiring', () => {
  it('declares the input and forwards it to the CLI only when set', () => {
    expect(actionYml).toContain('minimum-release-age:')
    // Empty means "no cooldown", and an empty --minimum-release-age would be rejected
    // by the CLI, so the flag must be omitted rather than passed blank.
    expect(actionYml).toContain('if [ -n "$MINIMUM_RELEASE_AGE" ]; then')
    expect(actionYml).toContain('ARGS+=(--minimum-release-age "$MINIMUM_RELEASE_AGE")')
  })
})
