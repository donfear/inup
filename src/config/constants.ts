/**
 * Constants for npm registry queries and configuration
 */

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
export const JSDELIVR_CDN_URL = 'https://cdn.jsdelivr.net/npm'
export const MAX_CONCURRENT_REQUESTS = 150
export const CACHE_TTL = 5 * 60 * 1000 // 5 minutes in milliseconds
export const REQUEST_TIMEOUT = 60000 // 60 seconds in milliseconds

/**
 * Registry selection: 'jsdelivr' for fast CDN lookups, 'npm' for direct npm registry
 * Set to 'npm' to use npm registry by default instead of jsdelivr
 */
export const DEFAULT_REGISTRY: 'jsdelivr' | 'npm' = 'jsdelivr'

/**
 * Package manager lock files
 */
export const LOCK_FILES = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lockb',
} as const

/**
 * Package manager workspace files
 */
export const WORKSPACE_FILES = {
  pnpm: 'pnpm-workspace.yaml',
  // npm, yarn, and bun use package.json workspaces field
} as const
