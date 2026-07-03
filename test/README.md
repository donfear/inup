# Testing Strategy

This directory contains the test suite for `inup`: unit tests, integration tests, and the shared harnesses that make the interactive TUI testable without a real terminal.

## Test Structure

```
test/
├── unit/                    # Unit tests (mirrors src/)
│   ├── app/                 # composition root (upgrade-runner, interactive-ui)
│   ├── features/
│   │   ├── audit/           # vulnerability checker, presenter, controller
│   │   ├── changelog/       # clients, parsers, services
│   │   ├── debug/           # perf logger + performance tracker
│   │   ├── headless/        # --json/--check/--apply runner + report
│   │   ├── interactive/     # the TUI: session, dispatch, state, renderers, modals
│   │   └── upgrade/         # package detector + upgrader
│   ├── shared/              # exec, fs, versions, config, terminal,
│   │   └── ...              #   http, registry, package-manager
│   ├── action/              # GitHub Action helpers
│   └── cli.test.ts
├── integration/             # Integration tests
│   ├── package-managers.test.ts
│   ├── services.test.ts
│   └── apply-config-invariant.test.ts
├── fixtures/                # Test fixtures and factories
│   ├── test-package/        # Sample package for integration detection tests
│   ├── mock-registry.ts     # fetchPackageVersions mock factory
│   ├── package-info-factory.ts        # makePackageInfo(overrides)
│   ├── selection-state-factory.ts     # makeSelectionState(overrides)
│   └── performance-snapshot-factory.ts # makeSnapshot(overrides)
└── helpers/                 # Shared test infrastructure
    ├── setup.ts             # hoisted() wrapper around vi.hoisted
    ├── fake-stdin.ts        # installFakeStdin() — raw-mode TTY stand-in
    └── terminal-capture.ts  # captureStdout()/captureStderr() with geometry
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage (also enforces the coverage thresholds)
pnpm test:coverage
```

## Coverage Policy

Coverage is enforced as a **ratchet** in [vitest.config.ts](../vitest.config.ts)
(`coverage.thresholds`). `pnpm test:coverage` fails when line/statement/
function/branch coverage drops below the configured floor.

- When your change **raises** coverage meaningfully, raise the thresholds to
  just below the new actuals.
- Never lower a threshold to make a failing build pass — add tests instead.
- Excluded from coverage: type-only files, `src/cli.ts` (commander wiring,
  covered via `runCli` tests + integration), `src/index.ts` (re-export barrel),
  and `test/**` itself.
- Genuinely untestable code (e.g. `process.on('exit')` emergency handlers that
  only run during real process teardown) is marked with `/* v8 ignore start */`
  … `/* v8 ignore stop */` and a comment explaining why. Use this sparingly.

## Testing the interactive TUI

The TUI is tested end-to-end in-process — no real TTY needed:

- **`installFakeStdin()`** ([helpers/fake-stdin.ts](helpers/fake-stdin.ts))
  swaps `process.stdin` for a `PassThrough` with `isTTY = true` and a
  `setRawMode` spy. Real escape sequences decode through readline
  (`'\x1b[B'` → down arrow). A _bare_ ESC byte is only emitted after
  readline's 25ms `escapeCodeTimeout` — prefer letter keys (`i`, `?`, `t`) for
  closing modals, or pass a `waitMs` to `sendKeys`.
- **`captureStdout()`** ([helpers/terminal-capture.ts](helpers/terminal-capture.ts))
  spies on `process.stdout.write` and can fake `columns`/`rows`/`isTTY`.
- **Controller stubs**: `PackageInfoModalController` and
  `VulnerabilityAuditController` are stubbed as plain objects (see
  `interactive-session.test.ts`) so no network is touched.
- **Listener hygiene**: session tests assert `process.listenerCount('exit')`
  and `'SIGWINCH'` return to their baseline in `afterEach`.

### The user-config rule (important)

`configManager` ([src/shared/config/user-config.ts](../src/shared/config/user-config.ts))
is a module singleton that reads and **writes the user's real
`~/.config/inup/config.json`**. Any test that touches `StateManager`,
`ThemeManager`, `interactive-session`, or theme switching **must** mock it:

```typescript
vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: {
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
    getFilters: vi.fn(() => null),
    setFilters: vi.fn(),
  },
}))
```

`git status --porcelain` must stay clean after `pnpm test` — a dirty tree or a
modified user config means a test is writing where it shouldn't.

### Color and ANSI assertions

CI has no TTY, so chalk's level is 0 there (no ANSI emitted). Assert on
`stripAnsi`'d output (from `src/shared/terminal/text.ts`), or pin
`chalk.level` explicitly and restore it in `afterEach` when the test is about
the escape codes themselves.

### Keyboard assertions

Key bindings live in [src/features/interactive/keymap.ts](../src/features/interactive/keymap.ts)
(the single source of truth for dispatch, help overlay, footer, and README).
Look bindings up via `findBinding`/`KEY_BINDINGS` instead of hardcoding
letters.

## Test Types

### Unit Tests

Unit tests isolate a module and verify its behavior, mocking only what is
external to it (network, child processes, the user-config singleton). Notable
suites:

- **Interactive session** (`interactive-session.test.ts`) — drives the full
  TUI loop through a fake stdin: selection, confirmation, cancellation,
  modals, themes, resize, audit callbacks, and the no-raw-mode fallback.
- **Action dispatcher** (`action-dispatcher.test.ts`) — one test per input
  action against a real `StateManager` and stub controllers.
- **Renderers** (`renderer/*.test.ts`, `package-list.test.ts`, `modal.test.ts`,
  `package-info-sections.test.ts`) — pure string assertions on stripped output.
- **Network clients** (`github-client.test.ts`, `npm-registry-client.test.ts`,
  `vulnerability-checker.test.ts`) — `vi.stubGlobal('fetch', …)`; abort errors
  must rethrow, everything else degrades to null.
- **Registry** (`npm-registry.test.ts`) — undici pool mocking with retry,
  ETag, and adaptive-concurrency paths.
- **Filesystem** (`filesystem.test.ts`, `io.test.ts`, `paths.test.ts`) — real
  temp dirs via `mkdtempSync`, cleaned up in `afterEach`.

### Integration Tests

Integration tests verify the tool works correctly with real package managers:

- **Package Manager Compatibility** ([package-managers.test.ts](integration/package-managers.test.ts))
  - npm / yarn / pnpm / bun detection and compatibility
  - Workspace detection for all package managers

## CI/CD Testing

### Unit Test Workflow ([test.yml](../.github/workflows/test.yml))

- **Operating Systems**: Ubuntu, macOS, Windows (Node 24)
- **Coverage**: `pnpm test:coverage` runs in a dedicated job and enforces the
  thresholds; reports are uploaded as workflow artifacts.

### Package Manager Integration Workflow ([test-package-managers.yml](../.github/workflows/test-package-managers.yml))

Tests real package manager interactions (npm, yarn, pnpm, bun + workspaces).
Runs on push to main, pull requests, and a weekly schedule.

### Standard CI ([ci.yml](../.github/workflows/ci.yml))

Runs on every push/PR:

- Formatting checks
- Unit tests
- Build verification
- Architecture boundary checks (`pnpm lint:deps` via dependency-cruiser)

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('YourModule', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'inup-test-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should do something', () => {
    // Test implementation
    expect(true).toBe(true)
  })
})
```

### Integration Test Example

```typescript
describe('Integration Test', () => {
  it('should work with real package manager', () => {
    // Create test project
    execSync('npm init -y', { cwd: testDir })

    // Test inup functionality
    const { PackageManagerDetector } = require('../../src/shared/package-manager')
    const pm = PackageManagerDetector.detect(testDir)
    expect(pm.name).toBe('npm')
  })
})
```

## Best Practices

1. **Use temporary directories** for tests that create files
2. **Clean up after tests** in `afterEach` hooks — including restoring
   `process.stdin`/`stdout`, env vars (`vi.unstubAllEnvs`), globals
   (`vi.unstubAllGlobals`), and chalk levels
3. **Test edge cases** (invalid input, missing files, aborts, empty lists)
4. **Mock sparingly** — prefer real file system operations in temp dirs;
   mock the network, child processes, and the user-config singleton
5. **Keep tests fast** — unit tests should run in milliseconds; avoid real
   timers where fake timers work
6. **Test cross-platform** — use `os.tmpdir()` and `path.join`, never
   hardcoded `/tmp` or `~` (the suite runs on Windows in CI)
