import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POOL_CONNECTIONS } from './constants'
import { PACKAGE_NAME } from './package-meta'

/**
 * Project-level configuration loaded from .inuprc or .inuprc.json
 */
export interface InupProjectConfig {
  /**
   * Packages to ignore during upgrade checks.
   * Supports exact names and glob patterns (e.g., "@babel/*", "eslint-*")
   */
  ignore?: string[]

  /**
   * Packages whose major updates are suppressed. Minor/patch updates still
   * show; a package whose only available update is a new major is treated as
   * up to date. Same pattern syntax as `ignore`.
   */
  ignoreMajor?: string[]

  /**
   * Exclude directory patterns (regex patterns)
   */
  exclude?: string[]

  /**
   * Directory names to scan even though they are in the default skip list
   * (node_modules, dist, build, coverage, out, lib, es, esm, cjs).
   * Use this when a real package lives under e.g. "lib/".
   */
  scanDirs?: string[]

  /**
   * Show vulnerability badges for peerDependencies in the package list.
   * Defaults to false so peer dependency risk stays hidden unless explicitly enabled.
   */
  showPeerDependencyVulnerabilities?: boolean

  /**
   * Show vulnerability badges for optionalDependencies in the package list.
   * Defaults to false so optional dependency risk stays hidden unless explicitly enabled.
   */
  showOptionalDependencyVulnerabilities?: boolean

  /**
   * Pin registry-fetch parallelism for this project (integer 1..24) and disable
   * adaptive ramping. Escape hatch for known-slow networks; the --concurrency
   * flag overrides this.
   */
  concurrency?: number
}

const CONFIG_FILES = [
  `.${PACKAGE_NAME}rc`,
  `.${PACKAGE_NAME}rc.json`,
  `${PACKAGE_NAME}.config.json`,
]

/**
 * Load project configuration from .inuprc, .inuprc.json, or inup.config.json
 * Searches in the specified directory and parent directories up to root
 */
export function loadProjectConfig(cwd: string): InupProjectConfig {
  let currentDir = cwd

  while (true) {
    for (const configFile of CONFIG_FILES) {
      const configPath = join(currentDir, configFile)
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8')
          const config = JSON.parse(stripJsonComments(content)) as InupProjectConfig
          return normalizeConfig(config)
        } catch (error) {
          // Invalid JSON or read error - continue searching
          console.warn(`Warning: Failed to parse ${configPath}: ${error}`)
        }
      }
    }

    // Move to parent directory. join(root, '..') === root at the filesystem
    // root on every platform ('/' on POSIX, 'C:\' on Windows), so this is the
    // single, cross-platform loop terminator.
    const parentDir = join(currentDir, '..')
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return {}
}

/**
 * Remove line comments (slash-slash) and block comments (slash-star) so config files can
 * be self-documenting (the `--init` template relies on this). String-aware: a
 * `//` inside a JSON string (e.g. a URL) is left untouched. Comment characters
 * are replaced rather than deleted so JSON.parse error positions still line up
 * with the file.
 */
export function stripJsonComments(content: string): string {
  let result = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        result += char
      } else {
        result += ' '
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        result += '  '
        i++
      } else {
        result += char === '\n' ? char : ' '
      }
      continue
    }

    if (inString) {
      if (char === '\\') {
        result += char + (next ?? '')
        i++
        continue
      }
      if (char === '"') inString = false
      result += char
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      result += '  '
      i++
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      result += '  '
      i++
      continue
    }

    result += char
  }

  return result
}

/**
 * Normalize and validate the config
 */
function normalizeConfig(config: InupProjectConfig): InupProjectConfig {
  const normalized: InupProjectConfig = {}

  if (config.ignore) {
    if (Array.isArray(config.ignore)) {
      normalized.ignore = config.ignore.filter((item) => typeof item === 'string')
    }
  }

  if (config.ignoreMajor) {
    if (Array.isArray(config.ignoreMajor)) {
      normalized.ignoreMajor = config.ignoreMajor.filter((item) => typeof item === 'string')
    }
  }

  if (config.exclude) {
    if (Array.isArray(config.exclude)) {
      normalized.exclude = config.exclude.filter((item) => typeof item === 'string')
    }
  }

  if (config.scanDirs) {
    if (Array.isArray(config.scanDirs)) {
      normalized.scanDirs = config.scanDirs.filter((item) => typeof item === 'string')
    }
  }

  if (typeof config.showPeerDependencyVulnerabilities === 'boolean') {
    normalized.showPeerDependencyVulnerabilities = config.showPeerDependencyVulnerabilities
  }

  if (typeof config.showOptionalDependencyVulnerabilities === 'boolean') {
    normalized.showOptionalDependencyVulnerabilities = config.showOptionalDependencyVulnerabilities
  }

  if (config.concurrency !== undefined) {
    if (
      typeof config.concurrency === 'number' &&
      Number.isInteger(config.concurrency) &&
      config.concurrency >= 1 &&
      config.concurrency <= POOL_CONNECTIONS
    ) {
      normalized.concurrency = config.concurrency
    } else {
      // Never drop this one silently: the user set it to protect a slow or
      // metered link, and ignoring it would let the run adapt up to the pool
      // ceiling — the exact opposite of their intent.
      console.warn(
        `Warning: ignoring invalid "concurrency" in project config (expected an integer 1..${POOL_CONNECTIONS}, got ${JSON.stringify(config.concurrency)})`
      )
    }
  }

  return normalized
}

/**
 * Check if a package name matches any of the ignore patterns
 * Supports exact matches and glob patterns (* and ?)
 */
export function isPackageIgnored(packageName: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (matchesPattern(packageName, pattern)) {
      return true
    }
  }
  return false
}

/**
 * Match a package name against a pattern
 * Supports:
 * - Exact match: "lodash"
 * - Wildcard: "*" matches any sequence of characters
 * - Single char wildcard: "?" matches single character
 * - Scoped packages: "@babel/*" matches all @babel packages
 */
function matchesPattern(name: string, pattern: string): boolean {
  // Exact match
  if (pattern === name) {
    return true
  }

  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
    .replace(/\*/g, '.*') // * matches any sequence
    .replace(/\?/g, '.') // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(name)
}
