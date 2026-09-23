import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchVulnerabilities: vi.fn() }))

vi.mock('../../../../src/features/audit/vulnerability-checker', () => ({
  fetchVulnerabilities: mocks.fetchVulnerabilities,
}))

import {
  auditKey,
  fetchVulnerabilitiesPerVersion,
} from '../../../../src/features/audit/per-version-audit'

const advisoryFor = (packageName: string, version: string) => ({
  packageName,
  highestSeverity: 'high',
  vulnerabilities: [
    { id: 1, title: version, severity: 'high', url: 'u', vulnerable_versions: '*' },
  ],
})

describe('fetchVulnerabilitiesPerVersion', () => {
  beforeEach(() => {
    mocks.fetchVulnerabilities.mockReset()
    // Echo the requested version back as the advisory title, for every package.
    mocks.fetchVulnerabilities.mockImplementation(
      async (packages: Map<string, string>) =>
        new Map(Array.from(packages, ([name, version]) => [name, advisoryFor(name, version)]))
    )
  })

  it('sends one request when no name repeats', async () => {
    const results = await fetchVulnerabilitiesPerVersion([
      { name: 'lodash', version: '^4.17.21' },
      { name: 'react', version: '^19.0.0' },
    ])

    expect(mocks.fetchVulnerabilities).toHaveBeenCalledTimes(1)
    expect(mocks.fetchVulnerabilities).toHaveBeenCalledWith(
      new Map([
        ['lodash', '^4.17.21'],
        ['react', '^19.0.0'],
      ]),
      {}
    )
    expect(Array.from(results.keys())).toEqual(['lodash@^4.17.21', 'react@^19.0.0'])
  })

  it('splits repeated names into rounds and keys each result by its own version', async () => {
    const results = await fetchVulnerabilitiesPerVersion([
      { name: 'lodash', version: '^3.10.1' },
      { name: 'react', version: '^19.0.0' },
      { name: 'lodash', version: '^4.17.21' },
      { name: 'lodash', version: '^3.10.1' },
    ])

    // One extra request for the second lodash version; the repeated ^3.10.1 is not re-sent.
    expect(mocks.fetchVulnerabilities.mock.calls.map(([packages]) => Array.from(packages))).toEqual(
      [
        [
          ['lodash', '^3.10.1'],
          ['react', '^19.0.0'],
        ],
        [['lodash', '^4.17.21']],
      ]
    )
    expect(results.get(auditKey('lodash', '^3.10.1'))?.vulnerabilities[0].title).toBe('^3.10.1')
    expect(results.get(auditKey('lodash', '^4.17.21'))?.vulnerabilities[0].title).toBe('^4.17.21')
  })

  it('leaves out packages the endpoint reported nothing for', async () => {
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())

    const results = await fetchVulnerabilitiesPerVersion([{ name: 'lodash', version: '^4.17.21' }])

    expect(results.size).toBe(0)
  })

  it('passes rejectOnFailure through and rejects when any round fails', async () => {
    mocks.fetchVulnerabilities
      .mockResolvedValueOnce(new Map())
      .mockRejectedValueOnce(new Error('network'))

    await expect(
      fetchVulnerabilitiesPerVersion(
        [
          { name: 'lodash', version: '^3.10.1' },
          { name: 'lodash', version: '^4.17.21' },
        ],
        { rejectOnFailure: true }
      )
    ).rejects.toThrow('network')
    expect(mocks.fetchVulnerabilities).toHaveBeenCalledWith(expect.any(Map), {
      rejectOnFailure: true,
    })
  })
})
