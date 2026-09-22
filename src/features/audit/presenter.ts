import chalk from 'chalk'
import type {
  DependencyType,
  VulnerabilityDisplayOptions,
  VulnerabilitySummary,
} from '../../shared/types'

/** One color + badge label per severity, shared by the list badge and the info modal. */
const SEVERITY_STYLES: Record<
  VulnerabilitySummary['highestSeverity'],
  { color: (text: string) => string; label: string }
> = {
  critical: { color: chalk.bgRed.white.bold, label: 'CRIT' },
  high: { color: chalk.red, label: 'HIGH' },
  moderate: { color: chalk.yellow, label: 'MOD' },
  low: { color: chalk.gray, label: 'LOW' },
  info: { color: chalk.gray, label: 'INFO' },
}

export function getVulnerabilitySeverityColor(
  severity: VulnerabilitySummary['highestSeverity']
): (text: string) => string {
  return SEVERITY_STYLES[severity]?.color ?? chalk.gray
}

export function getVulnerabilityBadge(vulnerability: VulnerabilitySummary | undefined): string {
  const style = vulnerability && SEVERITY_STYLES[vulnerability.highestSeverity]
  return style ? style.color(`[${style.label}]`) : ''
}

export function shouldDisplayVulnerabilityForDependency(
  dependencyType: DependencyType,
  options: VulnerabilityDisplayOptions = {}
): boolean {
  switch (dependencyType) {
    case 'peerDependencies':
      return options.showPeerDependencyVulnerabilities === true
    case 'optionalDependencies':
      return options.showOptionalDependencyVulnerabilities === true
    default:
      return true
  }
}

export function getVulnerabilityLinkLabel(detailsUrl: string): string {
  return detailsUrl.includes('/advisories') ? 'Security:' : 'Details:'
}

export function selectRepresentativeAdvisory(
  vulnerability: VulnerabilitySummary
): VulnerabilitySummary['advisories'][number] | undefined {
  return vulnerability.advisories[0]
}

export function createVulnerabilitySummary(
  existing: VulnerabilitySummary | undefined,
  advisories: VulnerabilitySummary['advisories'],
  highestSeverity: VulnerabilitySummary['highestSeverity']
): VulnerabilitySummary {
  return {
    count: advisories.length,
    highestSeverity,
    detailsUrl: existing?.detailsUrl || advisories[0]?.url,
    advisories,
  }
}
