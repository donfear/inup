import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearRegistryTargetCache,
  registryTargetFor,
  scopeOfPackage,
} from '../../../../src/shared/registry/registry-config'

describe('registry-config', () => {
  beforeEach(() => {
    clearRegistryTargetCache()
  })

  describe('scopeOfPackage', () => {
    it('extracts the scope from scoped names', () => {
      expect(scopeOfPackage('@myco/pkg')).toBe('@myco')
      expect(scopeOfPackage('@a/b/c')).toBe('@a')
    })

    it('returns undefined for unscoped or malformed names', () => {
      expect(scopeOfPackage('chalk')).toBeUndefined()
      expect(scopeOfPackage('@no-slash')).toBeUndefined()
    })
  })

  describe('registryTargetFor', () => {
    // Every test passes an explicit npmrc override so results never depend on
    // the machine's real npm configuration.

    it('falls back to the public registry with an empty npm config', () => {
      const target = registryTargetFor('chalk', {})

      expect(target.origin).toBe('https://registry.npmjs.org')
      expect(target.pathPrefix).toBe('')
      expect(target.authHeader).toBeUndefined()
    })

    it('honors the default `registry` key for unscoped packages', () => {
      const target = registryTargetFor('lodash', {
        registry: 'https://registry.example.com/',
        '//registry.example.com/:_authToken': 'sekret',
      })

      expect(target.origin).toBe('https://registry.example.com')
      expect(target.pathPrefix).toBe('')
      expect(target.authHeader).toBe('Bearer sekret')
    })

    it('resolves a scoped registry, keeping its path prefix', () => {
      const target = registryTargetFor('@myco/pkg', {
        '@myco:registry': 'https://registry.example.com/artifactory/api/npm/npm-virtual/',
      })

      expect(target.origin).toBe('https://registry.example.com')
      expect(target.pathPrefix).toBe('/artifactory/api/npm/npm-virtual')
      expect(target.authHeader).toBeUndefined()
    })

    it('matches credentials recursively up the registry path', () => {
      const target = registryTargetFor('@myco/pkg', {
        '@myco:registry': 'https://registry.example.com/artifactory/api/npm/npm-virtual/',
        '//registry.example.com/artifactory/:_authToken': 'nested-token',
      })

      expect(target.authHeader).toBe('Bearer nested-token')
    })

    it('expands ${ENV_VAR} auth tokens the way npm does', () => {
      process.env.INUP_TEST_REGISTRY_TOKEN = 'from-env'
      try {
        const target = registryTargetFor('@env/pkg', {
          '@env:registry': 'https://registry.example.com/',
          '//registry.example.com/:_authToken': '${INUP_TEST_REGISTRY_TOKEN}',
        })

        expect(target.authHeader).toBe('Bearer from-env')
      } finally {
        delete process.env.INUP_TEST_REGISTRY_TOKEN
      }
    })

    it('builds Basic auth from username + base64 _password', () => {
      const target = registryTargetFor('@basic/pkg', {
        '@basic:registry': 'https://registry.example.com/npm/',
        '//registry.example.com/npm/:username': 'mike',
        '//registry.example.com/npm/:_password': Buffer.from('hunter2', 'utf8').toString('base64'),
      })

      expect(target.authHeader).toBe(
        `Basic ${Buffer.from('mike:hunter2', 'utf8').toString('base64')}`
      )
    })

    it('scopes without npmrc config fall back to the default registry', () => {
      const target = registryTargetFor('@unknown/pkg', {
        '@other:registry': 'https://registry.example.com/',
      })

      expect(target.origin).toBe('https://registry.npmjs.org')
    })

    it('memoizes resolutions per scope', () => {
      const first = registryTargetFor('some-unscoped-pkg')
      const second = registryTargetFor('another-unscoped-pkg')

      // Same object identity ⇒ the npm config chain was only resolved once.
      expect(second).toBe(first)
    })

    it('treats an unset ${ENV_VAR} token as no credentials, never `Bearer undefined`', () => {
      // registry-auth-token stringifies unset env references into the literal
      // "undefined"; sending that guarantees a 401 where anonymous might work.
      const target = registryTargetFor('@env/pkg', {
        '@env:registry': 'https://registry.example.com/',
        '//registry.example.com/:_authToken': '${DEFINITELY_UNSET_INUP_VAR}',
      })

      expect(target.authHeader).toBeUndefined()
    })

    it('ignores empty auth tokens', () => {
      const target = registryTargetFor('@empty/pkg', {
        '@empty:registry': 'https://registry.example.com/',
        '//registry.example.com/:_authToken': '',
      })

      expect(target.authHeader).toBeUndefined()
    })

    it('supports the legacy global _auth credential', () => {
      const target = registryTargetFor('@legacy/pkg', {
        '@legacy:registry': 'https://registry.example.com/',
        _auth: Buffer.from('user:pass', 'utf8').toString('base64'),
      })

      expect(target.authHeader).toBe(`Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`)
    })

    it('normalizes registries declared without a trailing slash', () => {
      const target = registryTargetFor('@noslash/pkg', {
        '@noslash:registry': 'https://registry.example.com/npm',
      })

      expect(target.origin).toBe('https://registry.example.com')
      expect(target.pathPrefix).toBe('/npm')
    })

    it('falls back to the public registry when the configured URL is garbage', () => {
      const target = registryTargetFor('@broken/pkg', {
        '@broken:registry': 'not a url at all',
      })

      expect(target.origin).toBe('https://registry.npmjs.org')
      expect(target.pathPrefix).toBe('')
    })

    it('never lets an npmrc override poison the per-scope cache', () => {
      const withOverride = registryTargetFor('@iso/pkg', {
        '@iso:registry': 'https://registry.example.com/',
      })
      const withDifferentOverride = registryTargetFor('@iso/pkg', {
        '@iso:registry': 'https://other.example.com/',
      })

      // Each override resolves independently — no stale memoized result leaks
      // from one injected config into the next.
      expect(withOverride.origin).toBe('https://registry.example.com')
      expect(withDifferentOverride.origin).toBe('https://other.example.com')
    })
  })
})
