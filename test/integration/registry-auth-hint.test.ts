import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A registry that refuses the request (401/403) is not a missing package: the user has to be told
 * which registry turned them away, once, on stderr — while `--json` stdout stays a pure document.
 *
 * Real chain: `runCli` → headless runner → `PackageDetector` → registry fetch over real HTTP to
 * local stand-in registries. Only the scope → registry mapping and the advisory audit are stubbed.
 */

const mocks = vi.hoisted(() => ({
  origins: new Map<string, string>(),
  fetchVulnerabilities: vi.fn(),
}))

// `@alpha/*` and `@beta/*` resolve to their own local registries; `@gamma/*` answers 404.
vi.mock('../../src/shared/registry/registry-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/registry/registry-config')>()),
  registryTargetFor: (packageName: string) => {
    const scope = packageName.slice(1, packageName.indexOf('/'))
    return {
      origin: mocks.origins.get(scope) ?? '',
      pathPrefix: '',
      authHeader: 'Bearer s3cret-token',
    }
  },
}))

vi.mock('../../src/features/audit/vulnerability-checker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/audit/vulnerability-checker')>()),
  fetchVulnerabilities: mocks.fetchVulnerabilities,
}))

import { runCli } from '../../src/cli'
import { setEtagCacheEnabled } from '../../src/shared/http/etag-store'
import { clearPackageCache } from '../../src/shared/registry/npm-registry'

// The real CLI chain loads its runners on demand; under coverage on a busy runner
// that alone can pass the default 5s budget.
const RUN_TIMEOUT_MS = 30_000

const servers: Server[] = []
const hits = new Map<string, number>()

async function registryAnswering(scope: string, status: number): Promise<string> {
  const server = createServer((_req, res) => {
    hits.set(scope, (hits.get(scope) ?? 0) + 1)
    res.writeHead(status, { 'content-type': 'application/json' }).end('{"error":"nope"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  mocks.origins.set(scope, origin)
  return origin
}

describe('registry auth failures (--json)', () => {
  let projectDir: string
  let alpha = ''
  let beta = ''
  let gamma = ''

  beforeAll(async () => {
    alpha = await registryAnswering('alpha', 401)
    beta = await registryAnswering('beta', 403)
    gamma = await registryAnswering('gamma', 404)
    setEtagCacheEnabled(false)
  })

  afterAll(async () => {
    setEtagCacheEnabled(true)
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  beforeEach(() => {
    clearPackageCache()
    hits.clear()
    mocks.fetchVulnerabilities.mockResolvedValue(new Map())
    projectDir = mkdtempSync(join(tmpdir(), 'inup-auth-'))
    writeFileSync(join(projectDir, 'package-lock.json'), '{}\n')
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: {
          '@alpha/one': '^1.0.0',
          '@alpha/two': '^1.0.0',
          '@beta/three': '^1.0.0',
          '@gamma/four': '^1.0.0',
        },
      })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(projectDir, { recursive: true, force: true })
  })

  it(
    'prints one hint per refusing registry on stderr and keeps stdout a pure document',
    async () => {
      const stdout: string[] = []
      const stderr: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...args) => stdout.push(args.join(' ')))
      vi.spyOn(console, 'info').mockImplementation((...args) => stdout.push(args.join(' ')))
      vi.spyOn(console, 'warn').mockImplementation((...args) => stderr.push(args.join(' ')))
      vi.spyOn(console, 'error').mockImplementation((...args) => stderr.push(args.join(' ')))

      await runCli({
        dir: projectDir,
        exclude: '',
        maxDepth: '10',
        json: true,
        // The JS transport; the native one's refusals are covered by the registry unit tests.
        native: false,
      } as any)

      // stdout: exactly the JSON document.
      expect(stdout).toHaveLength(1)
      expect(JSON.parse(stdout[0]).outdated).toEqual([])

      // stderr: one hint per refusing origin, with its status and package count.
      const alphaHints = stderr.filter((line) => line.includes(alpha))
      const betaHints = stderr.filter((line) => line.includes(beta))
      expect(alphaHints).toEqual([
        `Warning: ${alpha} refused access (401) for 2 package(s) — check the auth token for this registry in your .npmrc`,
      ])
      expect(betaHints).toEqual([
        `Warning: ${beta} refused access (403) for 1 package(s) — check the auth token for this registry in your .npmrc`,
      ])
      // A plain 404 is a missing package, not an auth problem.
      expect(stderr.some((line) => line.includes(gamma))).toBe(false)
      expect(stderr.join('\n')).not.toContain('s3cret')

      // Refusals are final: one request per package, no retries.
      expect(hits.get('alpha')).toBe(2)
      expect(hits.get('beta')).toBe(1)
    },
    RUN_TIMEOUT_MS
  )
})
