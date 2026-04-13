import { describe, expect, it } from 'vitest'
import { renderPackageInfoModal } from '../../../src/ui/modal'
import { PackageSelectionState } from '../../../src/types'
import { getVisualLength } from '../../../src/ui/utils'

const baseState: PackageSelectionState = {
  name: 'next',
  packageJsonPath: '/repo/package.json',
  packageJsonPaths: ['/repo/package.json'],
  currentVersionSpecifier: '^16.1.6',
  currentVersion: '16.1.6',
  rangeVersion: '16.2.0',
  latestVersion: '16.2.3',
  selectedOption: 'range',
  loadState: 'ready',
  hasRangeUpdate: true,
  hasMajorUpdate: true,
  type: 'dependencies',
  description:
    'A framework for building web applications with React and server rendering features.',
  repository: 'https://github.com/vercel/next.js/releases',
  homepage: 'https://nextjs.org',
  weeklyDownloads: 37100000,
  author: 'Vercel',
  license: 'MIT',
}

describe('modal renderer', () => {
  it('shows one canonical vulnerability link instead of many advisory URLs', () => {
    const lines = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 3,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-1',
          advisories: [
            {
              id: 1,
              title: 'Critical auth bypass in middleware',
              severity: 'high',
              url: 'https://github.com/advisories/GHSA-1',
            },
            {
              id: 2,
              title: 'SSRF in image optimizer',
              severity: 'moderate',
              url: 'https://github.com/advisories/GHSA-2',
            },
          ],
        },
      },
      100,
      24
    )

    const rendered = lines.join('\n')
    expect(rendered).toContain('Security:')
    expect(rendered).toContain('https://github.com/advisories/GHSA-1')
    expect(rendered).toContain('... and 2 more')
    expect(rendered).not.toContain('https://github.com/advisories/GHSA-2')
  })

  it('fits inside short terminal heights by trimming low-priority content', () => {
    const lines = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 2,
          highestSeverity: 'moderate',
          detailsUrl: 'https://github.com/advisories/GHSA-1',
          advisories: [
            {
              id: 1,
              title:
                'Long representative advisory title that would otherwise force the modal to grow a lot',
              severity: 'moderate',
              url: 'https://github.com/advisories/GHSA-1',
            },
          ],
        },
      },
      90,
      12
    )

    expect(lines.length).toBeLessThanOrEqual(12)
    expect(lines.some((line) => line.includes('╭'))).toBe(true)
    expect(lines.some((line) => line.includes('╰'))).toBe(true)
  })

  it('keeps vulnerability rows aligned with the modal frame width', () => {
    const lines = renderPackageInfoModal(
      {
        ...baseState,
        vulnerability: {
          count: 6,
          highestSeverity: 'high',
          detailsUrl: 'https://github.com/advisories/GHSA-q4gf-8mx6-v5v3',
          advisories: [
            {
              id: 1,
              title: 'Next.js has a Denial of Service with Server Components',
              severity: 'high',
              url: 'https://github.com/advisories/GHSA-q4gf-8mx6-v5v3',
            },
          ],
        },
      },
      120,
      24
    )

    const framedLines = lines.filter((line) => line.includes('│') || line.includes('╭') || line.includes('╰') || line.includes('├'))
    const widths = framedLines.map((line) => getVisualLength(line))
    expect(new Set(widths).size).toBe(1)
  })
})
