import { describe, expect, it } from 'vitest'
import {
  extractRepositoryUrl,
  parseGitHubRepo,
} from '../../../../src/features/changelog/parsers/repository-ref'

describe('extractRepositoryUrl', () => {
  it('returns an empty string for missing input', () => {
    expect(extractRepositoryUrl('')).toBe('')
  })

  it('strips git+ prefixes and .git suffixes', () => {
    expect(extractRepositoryUrl('git+https://github.com/octo/demo.git')).toBe(
      'https://github.com/octo/demo'
    )
  })

  it('expands the github: shorthand', () => {
    expect(extractRepositoryUrl('github:octo/demo')).toBe('https://github.com/octo/demo')
  })

  it('treats bare owner/repo as a GitHub reference', () => {
    expect(extractRepositoryUrl('octo/demo')).toBe('https://github.com/octo/demo')
  })

  it('leaves full URLs alone', () => {
    expect(extractRepositoryUrl('https://gitlab.com/octo/demo')).toBe(
      'https://gitlab.com/octo/demo'
    )
  })
})

describe('parseGitHubRepo', () => {
  it('extracts the owner and repository name', () => {
    expect(parseGitHubRepo('https://github.com/octo/demo')).toEqual({
      owner: 'octo',
      repo: 'demo',
    })
  })

  it('works with deeper paths', () => {
    expect(parseGitHubRepo('https://github.com/octo/demo/releases')).toEqual({
      owner: 'octo',
      repo: 'demo',
    })
  })

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubRepo('https://gitlab.com/octo/demo')).toBeNull()
    expect(parseGitHubRepo('')).toBeNull()
  })
})
