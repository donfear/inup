import * as semver from 'semver'

export function normalizeReleaseTag(tagName?: string): string | null {
  if (!tagName) return null

  const cleanedTag = semver.clean(tagName)
  if (cleanedTag) return cleanedTag

  const semverMatch = tagName.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?/)
  if (!semverMatch) return null

  return semver.clean(semverMatch[0])
}

// A `#`–`###` heading that opens with a version, bare, `v`-prefixed or in Keep a
// Changelog brackets: `## 1.2.3`, `## [1.2.3] - 2024-01-01`, `# [1.3.0](compare-link)`.
const RELEASE_HEADING_PREFIX = '(#{1,3})[ \\t]+\\[?v?'

export function extractVersionSection(changelog: string, version: string): string | null {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The version has to end there, so 1.2.3 never picks up 1.2.30 or 1.2.3-beta.1.
  const sectionRegex = new RegExp(
    `^${RELEASE_HEADING_PREFIX}${escapedVersion}(?=[\\s\\])]|$)[^\\n]*\\n`,
    'm'
  )

  const match = sectionRegex.exec(changelog)
  if (!match) return null

  // The section ends at the next release heading, or at any `#`/`##` heading at or above
  // its own level. `###` headings only end it when they name a version: conventional-changelog
  // writes `### Bug Fixes` under `# [1.3.0]`, and `### [1.0.1]` patch releases hold their
  // own `### Bug Fixes`.
  const level = Math.min(match[1].length, 2)
  const startIndex = match.index + match[0].length
  const nextSectionMatch = new RegExp(
    `^(?:#{1,${level}}[ \\t]|${RELEASE_HEADING_PREFIX}\\d+\\.\\d+\\.\\d+)`,
    'm'
  ).exec(changelog.slice(startIndex))
  const endIndex = nextSectionMatch ? startIndex + nextSectionMatch.index : changelog.length

  const section = changelog.slice(startIndex, endIndex).trim()
  if (section.length === 0) return null

  const lines = section.split('\n')
  if (lines.length > 100) {
    return `${lines.slice(0, 100).join('\n')}\n...`
  }

  return section
}
