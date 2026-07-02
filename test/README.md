# Testing Strategy

This directory contains the test suite for `inup`, which includes both unit tests and integration tests.

## Test Structure

```
test/
├── unit/                    # Unit tests (mirrors src/)
│   ├── app/                 # composition root (upgrade-runner)
│   ├── features/
│   │   ├── audit/           # vulnerability checker, presenter, controller
│   │   ├── changelog/
│   │   ├── headless/
│   │   ├── interactive/     # the TUI: state, renderer, modals, keymap
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
│   └── test-package/        # Sample package for testing
└── helpers/                 # Shared test setup
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

## Test Types

### Unit Tests

Unit tests verify individual functions and modules work correctly in isolation:

- **Package Manager Detector** ([unit/shared/package-manager.test.ts](unit/shared/package-manager.test.ts)) - 23 tests
  - Detection from `packageManager` field
  - Detection from lock files
  - Priority handling (packageManager field > lock files)
  - Multiple lock files scenario
  - Workspace detection
  - Edge cases (invalid JSON, missing files)

- **Version Utilities** ([unit/shared/versions.test.ts](unit/shared/versions.test.ts)) - 20 tests
  - Version comparison logic
  - Optimized range version calculation
  - Minor version finding
  - Semver edge cases (prereleases, invalid versions)

- **Filesystem Utilities** ([unit/shared/fs/filesystem.test.ts](unit/shared/fs/filesystem.test.ts)) - 29 tests
  - Finding package.json files
  - Reading and parsing package.json
  - Collecting dependencies (sync and async)
  - Recursive file searching
  - Workspace detection
  - Exclude patterns and depth limiting

- **Exec Utilities** ([unit/shared/exec.test.ts](unit/shared/exec.test.ts)) - 9 tests
  - Synchronous command execution
  - Asynchronous command execution
  - Error handling
  - Working directory handling

### Integration Tests

Integration tests verify the tool works correctly with real package managers:

- **Package Manager Compatibility** ([package-managers.test.ts](integration/package-managers.test.ts))
  - npm detection and compatibility
  - yarn detection and compatibility
  - pnpm detection and compatibility
  - bun detection and compatibility
  - Workspace detection for all package managers

## CI/CD Testing

### Unit Test Workflow ([test.yml](../.github/workflows/test.yml))

Runs unit tests across:
- **Operating Systems**: Ubuntu, macOS, Windows
- **Node Versions**: 20, 22, 24
- **Coverage**: Reports generated on Ubuntu + Node 24

### Package Manager Integration Workflow ([test-package-managers.yml](../.github/workflows/test-package-managers.yml))

Tests real package manager interactions:
- **npm**: Creates npm projects, verifies detection
- **yarn**: Creates yarn projects, verifies detection
- **pnpm**: Creates pnpm projects, verifies detection
- **bun**: Creates bun projects, verifies detection (Ubuntu & macOS only)
- **Workspaces**: Tests monorepo/workspace detection for all PMs

Runs on:
- Push to main
- Pull requests
- Weekly schedule (Mondays 8am UTC)

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

## Coverage Goals

- **Unit Tests**: Aim for >80% coverage on core logic
- **Integration Tests**: Verify all package managers work on all platforms
- **Edge Cases**: Test error handling, invalid inputs, edge cases

## Best Practices

1. **Use temporary directories** for tests that create files
2. **Clean up after tests** in `afterEach` hooks
3. **Test edge cases** (invalid input, missing files, etc.)
4. **Mock sparingly** - prefer real file system operations in integration tests
5. **Keep tests fast** - unit tests should run in milliseconds
6. **Test cross-platform** - ensure tests work on Windows, macOS, Linux
