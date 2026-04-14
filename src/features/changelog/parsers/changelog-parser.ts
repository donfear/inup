import * as semver from 'semver'

export function normalizeReleaseTag(tagName?: string): string | null {
  if (!tagName) return null

  const cleanedTag = semver.clean(tagName)
  if (cleanedTag) return cleanedTag

  const semverMatch = tagName.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?/)
  if (!semverMatch) return null

  return semver.clean(semverMatch[0])
}

export function extractVersionSection(changelog: string, version: string): string | null {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sectionRegex = new RegExp(`^##\\s+\\[?v?${escapedVersion}\\]?[^\\n]*\\n`, 'm')

  const match = sectionRegex.exec(changelog)
  if (!match) return null

  const startIndex = match.index + match[0].length
  const nextSectionMatch = /^## /m.exec(changelog.slice(startIndex))
  const endIndex = nextSectionMatch ? startIndex + nextSectionMatch.index : changelog.length

  const section = changelog.slice(startIndex, endIndex).trim()
  if (section.length === 0) return null

  const lines = section.split('\n')
  if (lines.length > 100) {
    return `${lines.slice(0, 100).join('\n')}\n...`
  }

  return section
}
