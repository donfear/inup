import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// spawnSync runs the real package-manager install; individual tests override it
// to simulate spawn errors, signals, and exit codes without shelling out.
const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  spawnSyncMock.mockImplementation(actual.spawnSync)
  return { ...actual, spawnSync: spawnSyncMock }
})

import { PackageUpgrader } from '../../../../src/features/upgrade/upgrader'
import type {
  PackageInfo,
  PackageManagerInfo,
  PackageUpgradeChoice,
} from '../../../../src/shared/types'

const makePackageManager = (overrides: Partial<PackageManagerInfo> = {}): PackageManagerInfo => ({
  name: 'npm',
  displayName: 'npm',
  lockFile: 'package-lock.json',
  workspaceFile: null,
  installCommand: 'npm --version',
  color: null,
  ...overrides,
})

describe('PackageUpgrader', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-upgrader-test-'))
  })

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('prints "No packages to upgrade" and returns when choices is empty', async () => {
    const upgrader = new PackageUpgrader(makePackageManager())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await upgrader.upgradePackages([], [])
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No packages to upgrade'))
    logSpy.mockRestore()
  })

  it('skips and warns when the target package.json does not exist', async () => {
    const missingPath = join(testDir, 'ghost', 'package.json')
    const upgrader = new PackageUpgrader(makePackageManager())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await upgrader.upgradePackages(
      [
        {
          name: 'lodash',
          packageJsonPath: missingPath,
          dependencyType: 'dependencies',
          upgradeType: 'range',
          targetVersion: '^4.17.21',
          currentVersionSpecifier: '^4.17.20',
        },
      ],
      []
    )

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('file not found'))
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('creates a missing dep section rather than crashing', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(pkgPath, `${JSON.stringify({ name: 'fixture' }, null, 2)}\n`)

    const upgrader = new PackageUpgrader(makePackageManager())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await upgrader.upgradePackages(
      [
        {
          name: 'react',
          packageJsonPath: pkgPath,
          dependencyType: 'peerDependencies',
          upgradeType: 'latest',
          targetVersion: '^19.0.0',
          currentVersionSpecifier: '^18.0.0',
        },
      ],
      []
    )

    expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).peerDependencies?.react).toBe('^19.0.0')
    logSpy.mockRestore()
  })

  it('counts unique package names (not choices) in the success message', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(
      pkgPath,
      `${JSON.stringify(
        {
          name: 'fixture',
          dependencies: { lodash: '^4.0.0' },
          devDependencies: { lodash: '^4.0.0' },
        },
        null,
        2
      )}\n`
    )

    const upgrader = new PackageUpgrader(makePackageManager())
    const messages: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: string) => messages.push(m))

    await upgrader.upgradePackages(
      [
        {
          name: 'lodash',
          packageJsonPath: pkgPath,
          dependencyType: 'dependencies',
          upgradeType: 'range',
          targetVersion: '^4.17.21',
          currentVersionSpecifier: '^4.0.0',
        },
        {
          name: 'lodash',
          packageJsonPath: pkgPath,
          dependencyType: 'devDependencies',
          upgradeType: 'range',
          targetVersion: '^4.17.21',
          currentVersionSpecifier: '^4.0.0',
        },
      ],
      []
    )

    expect(messages.find((m) => m.includes('Successfully upgraded'))).toMatch('1 package(s)')
    logSpy.mockRestore()
  })

  it('updates peer and optional dependency selections in their original sections', async () => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-upgrader-test-'))
    const packageJsonPath = join(testDir, 'package.json')

    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(
        {
          name: 'fixture',
          dependencies: {
            react: '^18.2.0',
          },
          peerDependencies: {
            react: '^18.2.0',
          },
          optionalDependencies: {
            fsevents: '^2.3.2',
          },
        },
        null,
        2
      )}\n`
    )

    const packageManager: PackageManagerInfo = {
      name: 'npm',
      displayName: 'npm',
      lockFile: 'package-lock.json',
      workspaceFile: null,
      installCommand: 'npm --version',
      color: null,
    }

    const choices: PackageUpgradeChoice[] = [
      {
        name: 'react',
        packageJsonPath,
        dependencyType: 'peerDependencies',
        upgradeType: 'latest',
        targetVersion: '^19.0.0',
        currentVersionSpecifier: '^18.2.0',
      },
      {
        name: 'fsevents',
        packageJsonPath,
        dependencyType: 'optionalDependencies',
        upgradeType: 'range',
        targetVersion: '^2.3.3',
        currentVersionSpecifier: '^2.3.2',
      },
    ]

    const packageInfos: PackageInfo[] = [
      {
        name: 'react',
        currentVersion: '^18.2.0',
        rangeVersion: '^18.3.0',
        latestVersion: '^19.0.0',
        type: 'dependencies',
        packageJsonPath,
        isOutdated: true,
        hasRangeUpdate: true,
        hasMajorUpdate: true,
      },
      {
        name: 'react',
        currentVersion: '^18.2.0',
        rangeVersion: '^18.3.0',
        latestVersion: '^19.0.0',
        type: 'peerDependencies',
        packageJsonPath,
        isOutdated: true,
        hasRangeUpdate: true,
        hasMajorUpdate: true,
      },
      {
        name: 'fsevents',
        currentVersion: '^2.3.2',
        rangeVersion: '^2.3.3',
        latestVersion: '^2.4.0',
        type: 'optionalDependencies',
        packageJsonPath,
        isOutdated: true,
        hasRangeUpdate: true,
        hasMajorUpdate: true,
      },
    ]

    const upgrader = new PackageUpgrader(packageManager)
    await upgrader.upgradePackages(choices, packageInfos)

    const updatedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

    expect(updatedPackageJson.dependencies.react).toBe('^18.2.0')
    expect(updatedPackageJson.peerDependencies.react).toBe('^19.0.0')
    expect(updatedPackageJson.optionalDependencies.fsevents).toBe('^2.3.3')
  })

  describe('format preservation', () => {
    it('preserves tab indentation and the absence of a trailing newline', async () => {
      const pkgPath = join(testDir, 'package.json')
      const raw = '{\n\t"name": "fixture",\n\t"dependencies": {\n\t\t"lodash": "^4.0.0"\n\t}\n}'
      writeFileSync(pkgPath, raw)

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^4.17.21',
            currentVersionSpecifier: '^4.0.0',
          },
        ],
        []
      )

      expect(readFileSync(pkgPath, 'utf-8')).toBe(
        '{\n\t"name": "fixture",\n\t"dependencies": {\n\t\t"lodash": "^4.17.21"\n\t}\n}'
      )
      logSpy.mockRestore()
    })

    it('preserves 4-space indentation, the trailing newline, and the ~/exact operators written', async () => {
      const pkgPath = join(testDir, 'package.json')
      const raw =
        '{\n' +
        '    "name": "fixture",\n' +
        '    "dependencies": {\n' +
        '        "lodash": "~4.0.0",\n' +
        '        "chalk": "5.0.0"\n' +
        '    }\n' +
        '}\n'
      writeFileSync(pkgPath, raw)

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '~4.17.21',
            currentVersionSpecifier: '~4.0.0',
          },
          {
            name: 'chalk',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'latest',
            targetVersion: '5.3.0',
            currentVersionSpecifier: '5.0.0',
          },
        ],
        []
      )

      expect(readFileSync(pkgPath, 'utf-8')).toBe(
        '{\n' +
          '    "name": "fixture",\n' +
          '    "dependencies": {\n' +
          '        "lodash": "~4.17.21",\n' +
          '        "chalk": "5.3.0"\n' +
          '    }\n' +
          '}\n'
      )
      logSpy.mockRestore()
    })

    it('leaves the file byte-identical when the chosen version already matches on disk', async () => {
      const pkgPath = join(testDir, 'package.json')
      const raw = '{\n  "name": "fixture",\n  "dependencies": {\n    "lodash": "^4.17.21"\n  }\n}\n'
      writeFileSync(pkgPath, raw)

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^4.17.21',
            currentVersionSpecifier: '^4.17.21',
          },
        ],
        []
      )

      expect(readFileSync(pkgPath, 'utf-8')).toBe(raw)
      logSpy.mockRestore()
    })

    it('preserves CRLF line endings instead of silently rewriting the file to LF', async () => {
      const pkgPath = join(testDir, 'package.json')
      const raw =
        '{\r\n' +
        '  "name": "fixture",\r\n' +
        '  "dependencies": {\r\n' +
        '    "lodash": "^4.0.0"\r\n' +
        '  }\r\n' +
        '}\r\n'
      writeFileSync(pkgPath, raw)

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^4.17.21',
            currentVersionSpecifier: '^4.0.0',
          },
        ],
        []
      )

      expect(readFileSync(pkgPath, 'utf-8')).toBe(
        '{\r\n' +
          '  "name": "fixture",\r\n' +
          '  "dependencies": {\r\n' +
          '    "lodash": "^4.17.21"\r\n' +
          '  }\r\n' +
          '}\r\n'
      )
      logSpy.mockRestore()
    })

    it('leaves a CRLF file byte-identical when the chosen version already matches on disk', async () => {
      const pkgPath = join(testDir, 'package.json')
      const raw =
        '{\r\n  "name": "fixture",\r\n  "dependencies": {\r\n    "lodash": "^4.17.21"\r\n  }\r\n}\r\n'
      writeFileSync(pkgPath, raw)

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^4.17.21',
            currentVersionSpecifier: '^4.17.21',
          },
        ],
        []
      )

      expect(readFileSync(pkgPath, 'utf-8')).toBe(raw)
      logSpy.mockRestore()
    })
  })

  it('logs the package directory, not the package.json file path (Windows-safe dirname)', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(
      pkgPath,
      `${JSON.stringify({ name: 'fixture', dependencies: { lodash: '^4.0.0' } }, null, 2)}\n`
    )

    // quiet mode logs plainly to stderr — no spinner frames to fish through
    const upgrader = new PackageUpgrader(makePackageManager(), { quiet: true })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await upgrader.upgradePackages(
      [
        {
          name: 'lodash',
          packageJsonPath: pkgPath,
          dependencyType: 'dependencies',
          upgradeType: 'range',
          targetVersion: '^4.17.21',
          currentVersionSpecifier: '^4.0.0',
        },
      ],
      []
    )

    const upgraded = errSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('Upgraded'))
    expect(upgraded).toContain(`in ${testDir}`)
    expect(upgraded).not.toContain('package.json')
    errSpy.mockRestore()
  })

  describe('pnpm catalog entries', () => {
    const WORKSPACE_YAML = `# workspace layout
packages:
  - packages/*

catalog:
  react: ^18.2.0
  lodash: ^4.17.0 # untouched

catalogs:
  react19:
    react: ^19.0.0
`

    it('writes catalog upgrades into pnpm-workspace.yaml, preserving comments', async () => {
      const yamlPath = join(testDir, 'pnpm-workspace.yaml')
      writeFileSync(yamlPath, WORKSPACE_YAML)

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'react',
            packageJsonPath: yamlPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^18.3.1',
            currentVersionSpecifier: '^18.2.0',
            catalog: 'default',
          },
          {
            name: 'react',
            packageJsonPath: yamlPath,
            dependencyType: 'dependencies',
            upgradeType: 'latest',
            targetVersion: '^19.2.0',
            currentVersionSpecifier: '^19.0.0',
            catalog: 'react19',
          },
        ],
        []
      )

      const raw = readFileSync(yamlPath, 'utf-8')
      expect(raw).toContain('react: ^18.3.1')
      expect(raw).toContain('react: ^19.2.0')
      expect(raw).toContain('# workspace layout')
      expect(raw).toContain('lodash: ^4.17.0 # untouched')
      logSpy.mockRestore()
    })

    it('routes mixed selections to package.json and pnpm-workspace.yaml respectively', async () => {
      const yamlPath = join(testDir, 'pnpm-workspace.yaml')
      const pkgPath = join(testDir, 'package.json')
      writeFileSync(yamlPath, WORKSPACE_YAML)
      writeFileSync(
        pkgPath,
        `${JSON.stringify({ name: 'fixture', dependencies: { zod: '^3.0.0' } }, null, 2)}\n`
      )

      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await upgrader.upgradePackages(
        [
          {
            name: 'zod',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^3.25.0',
            currentVersionSpecifier: '^3.0.0',
          },
          {
            name: 'react',
            packageJsonPath: yamlPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^18.3.1',
            currentVersionSpecifier: '^18.2.0',
            catalog: 'default',
          },
        ],
        []
      )

      expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).dependencies.zod).toBe('^3.25.0')
      const raw = readFileSync(yamlPath, 'utf-8')
      expect(raw).toContain('react: ^18.3.1')
      // The YAML file must never be touched by the JSON writer.
      expect(raw).toContain('packages:')
      logSpy.mockRestore()
    })
  })

  it('creates a missing dep section for range upgrades too', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(pkgPath, `${JSON.stringify({ name: 'fixture' }, null, 2)}\n`)

    const upgrader = new PackageUpgrader(makePackageManager())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await upgrader.upgradePackages(
      [
        {
          name: 'react',
          packageJsonPath: pkgPath,
          dependencyType: 'optionalDependencies',
          upgradeType: 'range',
          targetVersion: '^18.3.0',
          currentVersionSpecifier: '^18.0.0',
        },
      ],
      []
    )

    expect(JSON.parse(readFileSync(pkgPath, 'utf-8')).optionalDependencies?.react).toBe('^18.3.0')
    logSpy.mockRestore()
  })

  it('reports and rethrows when pnpm-workspace.yaml cannot be read for a catalog write', async () => {
    // A directory named pnpm-workspace.yaml passes the existsSync guard but
    // fails the read — the failure must surface, not be swallowed.
    const yamlPath = join(testDir, 'pnpm-workspace.yaml')
    mkdirSync(yamlPath)

    const upgrader = new PackageUpgrader(makePackageManager())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      upgrader.upgradePackages(
        [
          {
            name: 'react',
            packageJsonPath: yamlPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^18.3.1',
            currentVersionSpecifier: '^18.2.0',
            catalog: 'default',
          },
        ],
        []
      )
    ).rejects.toThrow()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'))
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('skips catalog writes cleanly when pnpm-workspace.yaml has vanished', async () => {
    const missingYaml = join(testDir, 'gone', 'pnpm-workspace.yaml')

    const upgrader = new PackageUpgrader(makePackageManager())
    const messages: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: string) => messages.push(m))

    await upgrader.upgradePackages(
      [
        {
          name: 'react',
          packageJsonPath: missingYaml,
          dependencyType: 'dependencies',
          upgradeType: 'range',
          targetVersion: '^18.3.1',
          currentVersionSpecifier: '^18.2.0',
          catalog: 'default',
        },
      ],
      []
    )

    expect(messages.some((m) => m.includes('file not found'))).toBe(true)
    logSpy.mockRestore()
  })

  it('reports and rethrows when a package.json cannot be parsed', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(pkgPath, '{malformed json')

    const upgrader = new PackageUpgrader(makePackageManager())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^4.17.21',
            currentVersionSpecifier: '^4.0.0',
          },
        ],
        []
      )
    ).rejects.toThrow()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'))
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('routes its own progress to stderr in quiet mode', async () => {
    const upgrader = new PackageUpgrader(makePackageManager(), { quiet: true })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await upgrader.upgradePackages([], [])

    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No packages to upgrade'))
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  describe('install failure handling', () => {
    const writeFixture = (dir: string) => {
      const pkgPath = join(dir, 'package.json')
      writeFileSync(
        pkgPath,
        `${JSON.stringify({ name: 'fixture', dependencies: { lodash: '^4.0.0' } }, null, 2)}\n`
      )
      return pkgPath
    }
    const makeChoice = (pkgPath: string): PackageUpgradeChoice => ({
      name: 'lodash',
      packageJsonPath: pkgPath,
      dependencyType: 'dependencies',
      upgradeType: 'range',
      targetVersion: '^4.17.21',
      currentVersionSpecifier: '^4.0.0',
    })

    it('throws the spawn error when the install cannot start', async () => {
      const pkgPath = writeFixture(testDir)
      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      spawnSyncMock.mockReturnValueOnce({ error: new Error('spawn failed') })

      try {
        await expect(upgrader.upgradePackages([makeChoice(pkgPath)], [])).rejects.toThrow(
          'spawn failed'
        )
      } finally {
        logSpy.mockRestore()
      }
    })

    it('reports the signal when the install is killed', async () => {
      const pkgPath = writeFixture(testDir)
      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      spawnSyncMock.mockReturnValueOnce({ status: null, signal: 'SIGKILL' })

      try {
        await expect(upgrader.upgradePackages([makeChoice(pkgPath)], [])).rejects.toThrow(
          'terminated by signal SIGKILL'
        )
      } finally {
        logSpy.mockRestore()
      }
    })

    it('reports the exit code when the install fails', async () => {
      const pkgPath = writeFixture(testDir)
      const upgrader = new PackageUpgrader(makePackageManager())
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      spawnSyncMock.mockReturnValueOnce({ status: 3, signal: null })

      try {
        await expect(upgrader.upgradePackages([makeChoice(pkgPath)], [])).rejects.toThrow(
          'exited with code 3'
        )
      } finally {
        logSpy.mockRestore()
      }
    })

    it('redirects the install stdout to stderr in quiet mode', async () => {
      const pkgPath = writeFixture(testDir)
      const upgrader = new PackageUpgrader(makePackageManager(), { quiet: true })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      spawnSyncMock.mockReturnValueOnce({ status: 0, signal: null })

      try {
        await upgrader.upgradePackages([makeChoice(pkgPath)], [])
        const installCall = spawnSyncMock.mock.calls.at(-1)
        expect(installCall?.[1]).toMatchObject({ stdio: ['inherit', 2, 'inherit'] })
      } finally {
        errorSpy.mockRestore()
      }
    })
  })

  describe('quiet catalog upgrades', () => {
    it('logs catalog success without a spinner in quiet mode', async () => {
      const workspacePath = join(testDir, 'pnpm-workspace.yaml')
      writeFileSync(workspacePath, 'catalog:\n  react: ^18.0.0\n')
      const upgrader = new PackageUpgrader(makePackageManager(), { quiet: true })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      spawnSyncMock.mockReturnValueOnce({ status: 0, signal: null })

      try {
        await upgrader.upgradePackages(
          [
            {
              name: 'react',
              packageJsonPath: workspacePath,
              dependencyType: 'dependencies',
              upgradeType: 'latest',
              targetVersion: '^19.0.0',
              currentVersionSpecifier: '^18.0.0',
              catalog: 'default',
            },
          ],
          []
        )

        expect(readFileSync(workspacePath, 'utf-8')).toContain('react: ^19.0.0')
        expect(errorSpy.mock.calls.flat().join('\n')).toContain('Upgraded 1 catalog entry')
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('logs catalog failure without a spinner in quiet mode', async () => {
      const workspacePath = join(testDir, 'pnpm-workspace.yaml')
      writeFileSync(workspacePath, 'catalog:\n  react: ^18.0.0\n')
      chmodSync(workspacePath, 0o000)
      const upgrader = new PackageUpgrader(makePackageManager(), { quiet: true })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await expect(
          upgrader.upgradePackages(
            [
              {
                name: 'react',
                packageJsonPath: workspacePath,
                dependencyType: 'dependencies',
                upgradeType: 'latest',
                targetVersion: '^19.0.0',
                currentVersionSpecifier: '^18.0.0',
                catalog: 'default',
              },
            ],
            []
          )
        ).rejects.toThrow()
        expect(errorSpy.mock.calls.flat().join('\n')).toContain('Failed to upgrade catalog entries')
      } finally {
        chmodSync(workspacePath, 0o644)
        errorSpy.mockRestore()
      }
    })
  })

  it('skips the file write when the dependency is already at the target version', async () => {
    const pkgPath = join(testDir, 'package.json')
    const original = `${JSON.stringify({ name: 'fixture', dependencies: { lodash: '^4.17.21' } }, null, 2)}\n`
    writeFileSync(pkgPath, original)
    const upgrader = new PackageUpgrader(makePackageManager())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    spawnSyncMock.mockReturnValueOnce({ status: 0, signal: null })

    try {
      await upgrader.upgradePackages(
        [
          {
            name: 'lodash',
            packageJsonPath: pkgPath,
            dependencyType: 'dependencies',
            upgradeType: 'range',
            targetVersion: '^4.17.21',
            currentVersionSpecifier: '^4.17.21',
          },
        ],
        []
      )

      expect(readFileSync(pkgPath, 'utf-8')).toBe(original)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('logs a plain failure without a spinner when a quiet upgrade throws', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(pkgPath, 'this is not json {')
    const upgrader = new PackageUpgrader(makePackageManager(), { quiet: true })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(
        upgrader.upgradePackages(
          [
            {
              name: 'lodash',
              packageJsonPath: pkgPath,
              dependencyType: 'dependencies',
              upgradeType: 'range',
              targetVersion: '^4.17.21',
              currentVersionSpecifier: '^4.0.0',
            },
          ],
          []
        )
      ).rejects.toThrow()
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Failed to upgrade dependencies')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
