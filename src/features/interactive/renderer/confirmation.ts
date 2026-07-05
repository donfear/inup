import chalk from 'chalk'
import type { PackageUpgradeChoice } from '../../../shared/types'

/**
 * Render confirmation screen
 */
export function renderConfirmation(choices: PackageUpgradeChoice[]): string {
  if (choices.length === 0) {
    return chalk.yellow('No packages selected for upgrade.')
  }

  // Group choices by package name to show unique packages
  const packagesByName = new Map<string, PackageUpgradeChoice[]>()
  choices.forEach((choice) => {
    const group = packagesByName.get(choice.name)
    if (group) {
      group.push(choice)
    } else {
      packagesByName.set(choice.name, [choice])
    }
  })

  let output = chalk.bold(`\n🚀 Ready to upgrade ${packagesByName.size} package(s):\n`)
  packagesByName.forEach((packageChoices, packageName) => {
    // Use the first choice for display (they should all have the same target version for the same package)
    const choice = packageChoices[0]
    const upgradeTypeColor = choice.upgradeType === 'range' ? chalk.yellow : chalk.red
    const instancesText =
      packageChoices.length > 1 ? chalk.gray(` (${packageChoices.length} instances)`) : ''
    output += `  • ${chalk.cyan(packageName)} → ${upgradeTypeColor(choice.targetVersion)} ${chalk.gray(`(${choice.upgradeType})`)}${instancesText}\n`
  })

  output += chalk.gray('Press Enter/Y to proceed, N to go back to selection, ESC to cancel\n')

  return output
}
