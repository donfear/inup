import { execSync, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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

/**
 * Execute a command asynchronously
 */
export async function executeCommandAsync(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { encoding: 'utf-8' })
    if (stderr && !stdout) {
      throw new Error(stderr)
    }
    return stdout
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error}`)
  }
}
