/**
 * Build-time extraction from the repo's README.md marker sections.
 * The markers are maintained by the repo's own tooling, so a parse failure
 * means real drift — we throw to fail the build loudly rather than ship
 * stale or empty content. Runs only at build time (static output).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Located by walking up to the workspace root, not via import.meta.url:
// the bundled module lives in dist/.prerender/chunks/ at build time, and
// cwd may be either the website package or the repo root.
function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find the repo root (pnpm-workspace.yaml) above ${from}`);
    }
    dir = parent;
  }
  return dir;
}

const readmePath = join(findRepoRoot(process.cwd()), 'README.md');
const readme = readFileSync(readmePath, 'utf8');

function markerSection(name: string): string {
  const match = readme.match(
    new RegExp(`<!-- ${name}:START -->([\\s\\S]*?)<!-- ${name}:END -->`),
  );
  if (!match) {
    throw new Error(`README.md: marker section "${name}" not found — did the markers move?`);
  }
  return match[1].trim();
}

export interface KeyBinding {
  keys: string;
  action: string;
}

/** Keyboard shortcuts parsed from the KEYS marker table. */
export const keys: KeyBinding[] = markerSection('KEYS')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('|'))
  .slice(2) // header + separator
  .map((line) => {
    const cells = line.split('|').map((c) => c.trim());
    const keysCell = cells[1]?.replace(/`/g, '');
    const action = cells[2];
    if (!keysCell || !action) {
      throw new Error(`README.md: unparseable KEYS row: ${line}`);
    }
    return { keys: keysCell, action };
  });

if (keys.length < 10) {
  throw new Error(`README.md: KEYS table suspiciously short (${keys.length} rows)`);
}

/** Test count and coverage parsed from the TEST-BADGES marker section. */
export const testStats: { tests: number; coverage: string } = (() => {
  const section = markerSection('TEST-BADGES');
  const tests = section.match(/tests-(\d+)_passing/);
  const coverage = section.match(/coverage-(\d+(?:\.\d+)?)%25/);
  if (!tests || !coverage) {
    throw new Error('README.md: could not parse test/coverage badges from TEST-BADGES section');
  }
  return { tests: Number(tests[1]), coverage: `${coverage[1]}%` };
})();
