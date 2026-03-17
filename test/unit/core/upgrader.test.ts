import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PackageUpgrader } from '../../../src/core/upgrader'
import { PackageInfo, PackageManagerInfo, PackageUpgradeChoice } from '../../../src/types'

describe('PackageUpgrader', () => {
  let testDir: string

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
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
})
