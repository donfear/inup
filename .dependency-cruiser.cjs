/**
 * Architecture boundary rules for the feature-first layout:
 *
 *   cli.ts / index.ts  →  app/  →  features/*  →  shared/
 *
 * Feature dependency policy (everything else is forbidden):
 *   interactive → audit, changelog, debug
 *   upgrade     → debug
 *   headless    → upgrade, audit, debug
 *   audit, changelog, debug → (leaf features: shared only)
 *
 * Cross-feature imports must go through the target feature's index.ts;
 * a feature never imports its own index.ts.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Runtime import cycles are forbidden (type-only edges are erased at compile time)',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'shared-stays-low',
      severity: 'error',
      comment: 'shared/ is the bottom layer and must not import app, features, or entry points',
      from: { path: '^src/shared' },
      to: { path: '^src/(app|features)|^src/(cli|index)\\.ts$' },
    },
    {
      name: 'features-dont-reach-up',
      severity: 'error',
      comment: 'features must not import the composition root or entry points',
      from: { path: '^src/features' },
      to: { path: '^src/app|^src/(cli|index)\\.ts$' },
    },
    {
      name: 'feature-to-feature-via-index-only',
      severity: 'error',
      comment: "another feature's internals are private — import its index.ts",
      from: { path: '^src/features/([^/]+)/' },
      to: { path: '^src/features/(?!$1/)[^/]+/(?!index\\.ts$).+' },
    },
    {
      name: 'no-feature-self-barrel',
      severity: 'error',
      comment: "a feature must not import its own index.ts (circular-import risk)",
      from: { path: '^src/features/([^/]+)/(?!index\\.ts$)' },
      to: { path: '^src/features/$1/index\\.ts$' },
    },
    {
      name: 'audit-is-leaf',
      severity: 'error',
      from: { path: '^src/features/audit' },
      to: { path: '^src/features/(?!audit/)' },
    },
    {
      name: 'changelog-is-leaf',
      severity: 'error',
      from: { path: '^src/features/changelog' },
      to: { path: '^src/features/(?!changelog/)' },
    },
    {
      name: 'debug-is-leaf',
      severity: 'error',
      from: { path: '^src/features/debug' },
      to: { path: '^src/features/(?!debug/)' },
    },
    {
      name: 'upgrade-peers',
      severity: 'error',
      comment: 'upgrade may only depend on debug among features',
      from: { path: '^src/features/upgrade' },
      to: { path: '^src/features/(?!upgrade/|debug/)' },
    },
    {
      name: 'headless-peers',
      severity: 'error',
      comment: 'headless may only depend on upgrade, audit, and debug among features',
      from: { path: '^src/features/headless' },
      to: { path: '^src/features/(?!headless/|upgrade/|audit/|debug/)' },
    },
    {
      name: 'interactive-peers',
      severity: 'error',
      comment: 'interactive may only depend on audit, changelog, and debug among features',
      from: { path: '^src/features/interactive' },
      to: { path: '^src/features/(?!interactive/|audit/|changelog/|debug/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
}
