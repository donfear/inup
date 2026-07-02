import { existsSync, readFileSync } from 'fs'
import { join, dirname, parse } from 'path'

/**
 * Loads a gitignored `.env.local` from the inup repo itself (NOT the cwd), so
 * developer-only toggles can be "set once" and apply to every `inup` run in any
 * project — without committing anything or touching the shell profile.
 *
 * The repo is located by walking UP from this file's own directory until a
 * `.env.local` is found, so it works regardless of nesting depth (src/shared when
 * type-stripped, dist/utils when compiled) and resolves the inup repo even when
 * the binary is linked and invoked from a different project directory.
 *
 * Fully optional and best-effort: if the file is absent or unreadable, nothing
 * happens and the run proceeds exactly as before. Existing process env always
 * wins, so a one-off `INUP_PERF=0 inup` still overrides the file.
 */

const ENV_FILE_NAME = '.env.local'

/** Walk upward from this file's dir to find the .env.local; null if none. */
function findEnvFile(): string | null {
  let dir = __dirname
  const root = parse(dir).root
  // Cap the walk so a missing file can never loop unbounded.
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, ENV_FILE_NAME)
    if (existsSync(candidate)) return candidate
    if (dir === root) break
    dir = dirname(dir)
  }
  return null
}

/** Parse a minimal KEY=VALUE env file. Ignores blanks and `#` comments. */
function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    // Strip a single layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Apply `<inup-repo>/.env.local` into process.env. Existing values are never
 * overwritten (real env / one-off overrides win). Returns the path if loaded.
 */
export function loadInupLocalEnv(): string | null {
  try {
    const file = findEnvFile()
    if (!file) return null
    const parsed = parseEnv(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
    return file
  } catch {
    // Best-effort: never let a dev convenience break a real run.
    return null
  }
}
