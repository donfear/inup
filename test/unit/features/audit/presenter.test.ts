import { describe, expect, it } from 'vitest'
import {
  createVulnerabilitySummary,
  getVulnerabilityBadge,
  getVulnerabilityLinkLabel,
  getVulnerabilitySeverityColor,
  selectRepresentativeAdvisory,
  shouldDisplayVulnerabilityForDependency,
} from '../../../../src/features/audit/presenter'

describe('vulnerability presenter', () => {
  it('maps severity badges consistently', () => {
    expect(
      getVulnerabilityBadge({
        count: 1,
        highestSeverity: 'critical',
        detailsUrl: 'https://github.com/advisories/GHSA-1',
        advisories: [],
      })
    ).toContain('[CRIT]')
    expect(
      getVulnerabilityBadge({
        count: 1,
        highestSeverity: 'high',
        detailsUrl: 'https://github.com/advisories/GHSA-1',
        advisories: [],
      })
    ).toContain('[HIGH]')
  })

  it('labels advisory links as security links', () => {
    expect(getVulnerabilityLinkLabel('https://github.com/advisories/GHSA-1')).toBe('Security:')
    expect(getVulnerabilityLinkLabel('https://example.com/details')).toBe('Details:')
  })

  it('renders no badge for an unrecognized severity', () => {
    expect(
      getVulnerabilityBadge({
        count: 1,
        highestSeverity: 'bizarre' as never,
        detailsUrl: 'https://github.com/advisories/GHSA-1',
        advisories: [],
      })
    ).toBe('')
  })

  it('keeps an existing detail link over the first advisory url', () => {
    const summary = createVulnerabilitySummary(
      {
        count: 1,
        highestSeverity: 'high',
        detailsUrl: 'https://github.com/advisories/GHSA-existing',
        advisories: [],
      },
      [
        {
          id: 1,
          title: 'Advisory',
          severity: 'high',
          url: 'https://github.com/advisories/GHSA-new',
        },
      ],
      'high'
    )

    expect(selectRepresentativeAdvisory(summary)?.id).toBe(1)
    expect(summary.detailsUrl).toBe('https://github.com/advisories/GHSA-existing')
    // Without an existing link, the first advisory supplies it.
    expect(createVulnerabilitySummary(undefined, summary.advisories, 'high').detailsUrl).toBe(
      'https://github.com/advisories/GHSA-new'
    )
  })
})

describe('severity presentation matrix', () => {
  const summary = (highestSeverity: 'critical' | 'high' | 'moderate' | 'low' | 'info') => ({
    count: 1,
    highestSeverity,
    detailsUrl: 'https://github.com/advisories/GHSA-1',
    advisories: [],
  })

  it('maps every severity to a badge and none for missing data', () => {
    expect(getVulnerabilityBadge(summary('moderate'))).toContain('[MOD]')
    expect(getVulnerabilityBadge(summary('low'))).toContain('[LOW]')
    expect(getVulnerabilityBadge(summary('info'))).toContain('[INFO]')
    expect(getVulnerabilityBadge(undefined)).toBe('')
  })

  it('provides a color function for every severity', () => {
    for (const severity of ['critical', 'high', 'moderate', 'low', 'info'] as const) {
      const color = getVulnerabilitySeverityColor(severity)
      expect(color('x')).toBeTypeOf('string')
    }
  })

  it('falls back to a neutral color for an unrecognized severity', () => {
    expect(getVulnerabilitySeverityColor('bizarre' as never)('x')).toBe(
      getVulnerabilitySeverityColor('info')('x')
    )
  })
})

describe('shouldDisplayVulnerabilityForDependency', () => {
  it('always shows production and dev dependency vulnerabilities', () => {
    expect(shouldDisplayVulnerabilityForDependency('dependencies')).toBe(true)
    expect(shouldDisplayVulnerabilityForDependency('devDependencies')).toBe(true)
  })

  it('hides peer and optional dependency vulnerabilities unless opted in', () => {
    expect(shouldDisplayVulnerabilityForDependency('peerDependencies')).toBe(false)
    expect(shouldDisplayVulnerabilityForDependency('optionalDependencies')).toBe(false)

    expect(
      shouldDisplayVulnerabilityForDependency('peerDependencies', {
        showPeerDependencyVulnerabilities: true,
      })
    ).toBe(true)
    expect(
      shouldDisplayVulnerabilityForDependency('optionalDependencies', {
        showOptionalDependencyVulnerabilities: true,
      })
    ).toBe(true)
  })
})
