export { type AuditBatch, type AuditPackageInput, BackgroundAuditTracker } from './background-audit'
export { auditVulnerabilities, upgradeClears } from './headless-audit'
export {
  createVulnerabilitySummary,
  getVulnerabilityBadge,
  getVulnerabilityLinkLabel,
  getVulnerabilitySeverityColor,
  mergeVulnerabilitySummary,
  selectRepresentativeAdvisory,
  shouldDisplayVulnerabilityForDependency,
} from './presenter'
export * from './types'
export { VulnerabilityAuditController } from './vulnerability-audit-controller'
export {
  fetchVulnerabilities,
  type PackageVulnerabilities,
  type VulnerabilityInfo,
} from './vulnerability-checker'
