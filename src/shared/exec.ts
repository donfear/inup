import { execSync } from 'node:child_process'

/**
 * Execute a command synchronously
 */
export function executeCommand(command: string, cwd?: string): string {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      cwd: cwd,
    })
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error}`)
  }
}
