import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PackageUpgrader } from '../../../../src/features/upgrade/upgrader'
import { PackageInfo, PackageManagerInfo, PackageUpgradeChoice } from '../../../../src/shared/types'

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
    writeFileSync(pkgPath, JSON.stringify({ name: 'fixture' }, null, 2) + '\n')

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
      JSON.stringify(
        {
          name: 'fixture',
          dependencies: { lodash: '^4.0.0' },
          devDependencies: { lodash: '^4.0.0' },
        },
        null,
        2
      ) + '\n'
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
      JSON.stringify(
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
      ) + '\n'
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
  })

  it('creates a missing dep section for range upgrades too', async () => {
    const pkgPath = join(testDir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'fixture' }, null, 2) + '\n')

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
})
