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
      // Ratchet: coverage is at 100% on every metric and must stay there.
      // Provably-unreachable defensive code is annotated with `/* v8 ignore */`
      // hints (each with a justification comment) rather than left uncovered.
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
