export * from './types'
export {
  fetchVulnerabilities,
  type VulnerabilityInfo,
  type PackageVulnerabilities,
} from './vulnerability-checker'
export { BackgroundAuditTracker, type AuditPackageInput, type AuditBatch } from './background-audit'
export { VulnerabilityAuditController } from './vulnerability-audit-controller'
export {
  createVulnerabilitySummary,
  getVulnerabilityBadge,
  getVulnerabilityLinkLabel,
  getVulnerabilitySeverityColor,
  mergeVulnerabilitySummary,
  selectRepresentativeAdvisory,
  shouldDisplayVulnerabilityForDependency,
} from './presenter'
export { auditVulnerabilities, upgradeClears } from './headless-audit'
