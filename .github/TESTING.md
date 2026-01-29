# Testing Documentation

## Overview

This project uses a comprehensive testing strategy that includes unit tests, integration tests, and cross-platform CI/CD testing to ensure `inup` works reliably across all supported package managers (npm, yarn, pnpm, bun) and platforms (Linux, macOS, Windows).

## Test Commands

```bash
# Run all tests
pnpm test

# Run tests in watch mode (development)
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage
```

## Test Structure

### Unit Tests (Co-located with Source)

Unit tests are placed next to the source files they test:

- `src/services/package-manager-detector.test.ts` - 23 tests
- `src/utils/version.test.ts` - 20 tests

**Coverage:**
- Package Manager Detector: 99.3%
- Version Utilities: 91.13%

### Integration Tests

Located in `test/integration/`:

- `package-managers.test.ts` - Tests real package manager interactions (11 tests)

## CI/CD Workflows

### 1. Unit Tests Workflow ([test.yml](.github/workflows/test.yml))

Runs comprehensive unit tests across multiple environments:

**Matrix:**
- OS: Ubuntu, macOS, Windows
- Node: 20, 22, 24

**Total: 27 test runs** (3 OS × 3 Node versions × 3 test files)

### 2. Package Manager Integration Workflow ([test-package-managers.yml](.github/workflows/test-package-managers.yml))

Tests real package manager compatibility:

**Tests:**
- npm (Ubuntu, macOS, Windows × Node 20, 24) = 6 runs
- yarn (Ubuntu, macOS, Windows × Node 20, 24) = 6 runs
- pnpm (Ubuntu, macOS, Windows × Node 20, 24) = 6 runs
- bun (Ubuntu, macOS × latest) = 2 runs
- Workspaces (Ubuntu × npm, yarn, pnpm) = 3 runs

**Total: 23 integration test runs**

**Schedule:**
- On push/PR to main
- Weekly (Mondays 8am UTC)

### 3. Standard CI ([ci.yml](.github/workflows/ci.yml))

Runs on every push/PR:
- Formatting checks
- Unit tests
- Build verification

## What We Test

### Package Manager Detection

✅ Detection from `packageManager` field in package.json
✅ Detection from lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb)
✅ Priority handling (packageManager field > lock files)
✅ Multiple lock files scenario (uses most recent)
✅ Workspace/monorepo detection for all package managers
✅ Edge cases (invalid JSON, missing files)

### Version Management

✅ Version comparison with semver
✅ Handling version prefixes (^, ~, >=)
✅ Optimized range version calculation
✅ Minor version finding algorithm
✅ Invalid version handling
✅ Prerelease versions

### Cross-Platform Compatibility

✅ Windows path handling
✅ macOS file system
✅ Linux environments
✅ Node 20, 22, 24 compatibility

### Package Manager Compatibility

✅ npm (all versions)
✅ yarn (classic & berry)
✅ pnpm (with workspace support)
✅ bun (latest)

## Test Results

All 54 tests passing:
- ✅ 20 version utility tests
- ✅ 23 package manager detector tests
- ✅ 11 integration tests

## Adding New Tests

When adding new features:

1. **Add unit tests** - Create `.test.ts` file next to the source
2. **Add integration tests** - If the feature interacts with package managers
3. **Update this doc** - Document what the tests cover

Example:
```typescript
import { describe, it, expect } from 'vitest'

describe('MyNewFeature', () => {
  it('should do something', () => {
    // Test implementation
    expect(true).toBe(true)
  })
})
```

## Coverage Goals

- **Core Logic**: >90% coverage
- **Services**: >80% coverage
- **Integration**: All package managers tested

Current coverage on tested modules:
- Package Manager Detector: 99.3% ✅
- Version Utilities: 91.13% ✅

## Troubleshooting

### Tests Fail Locally

```bash
# Clean and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Run tests
pnpm test
```

### CI Tests Fail

Check the specific workflow:
- Unit tests failing? Check Node version compatibility
- Integration tests failing? Check package manager availability
- Platform-specific failures? Check OS-specific file handling

## Future Improvements

- [ ] Add E2E tests with real CLI execution
- [ ] Add performance benchmarks
- [ ] Increase coverage to >90% overall
- [ ] Add mutation testing
- [ ] Add visual regression tests for CLI output
