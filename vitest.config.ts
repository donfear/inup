import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'dist/**',
        'docs/**',
        'test/**', // helpers/fixtures are test infrastructure, not product code
        '**/*.config.ts',
        '**/types.ts',
        'src/shared/types/**', // shared type vocabulary — no runtime code
        'src/cli.ts', // CLI entry point - tested via integration tests
        'src/index.ts', // public API re-export barrel
      ],
      // Ratchet: keep coverage from regressing. Raise these when coverage rises;
      // never lower them to make a failing build pass.
      // Current actuals: 97.1% lines / 96.5% statements / 96.0% functions / 90.7% branches.
      thresholds: {
        lines: 96,
        functions: 95,
        branches: 89,
        statements: 95,
      },
    },
  },
})
