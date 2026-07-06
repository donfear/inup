# Contributing to inup

Thanks for helping improve inup! This document covers setup, the quality gates every change
must pass, and the conventions the repo follows.

## Setup

- **Node ≥ 22.19.0** (undici@8 requirement; `.nvmrc` pins 24, which CI also uses)
- **pnpm** via Corepack: `corepack enable` (the exact version is pinned in `package.json`'s
  `packageManager` field)

```bash
git clone https://github.com/donfear/inup.git
cd inup
pnpm install
pnpm build          # compile to dist/
node dist/cli.js    # run your local build
```

`pnpm dev` runs `tsc --watch` for iterative work.

## Quality gates

CI enforces all of these; run them locally before pushing:

| Command | What it checks |
|---|---|
| `pnpm check` | Biome format + lint (auto-fixes; CI runs the read-only `check:ci`) |
| `pnpm lint:deps` | dependency-cruiser architecture boundaries (`cli → app → features/* → shared`, no cycles, cross-feature imports only via `index.ts`) |
| `pnpm test` | full unit + integration suite |
| `pnpm test:coverage` | the suite with the **100% coverage gate** — lines, statements, functions, and branches must all stay at 100% |
| `pnpm build` | TypeScript compile (strict mode) |

### The 100% coverage gate

Coverage is a ratchet, not an aspiration: `vitest.config.ts` fails the build below 100% on all
four metrics. Practically this means **every new branch you write needs a test in the same
PR**. Genuinely unreachable defensive code is annotated with `/* v8 ignore */` plus a short
justification — see existing usages before adding one.

Read [`test/README.md`](test/README.md) before writing tests. It documents the layout
(`test/unit` mirrors `src/`), the factories in `test/fixtures/`, and the in-process TUI testing
approach (`fake-stdin.ts`, `terminal-capture.ts` — no real terminal needed).

## Conventions

- **One feature or fix per PR**, branched from `main`.
- **README is partly generated.** The keyboard-shortcut table and the badge numbers are
  asserted by tests (`keymap-readme`, `badges-readme`). If you change the keymap, run
  `pnpm docs:keys`; badge drift beyond the allowed tolerance is refreshed with
  `pnpm docs:badges`.
- **Architecture is enforced, not aspirational.** New cross-feature dependencies must be added
  deliberately in `.dependency-cruiser.cjs`; if the cruiser rejects your import, reconsider the
  layering before loosening the rule.
- **Commit style**: conventional prefixes (`fix:`, `feat:`, `chore:`, `ci:`, `test:`).

## Releases

Maintainers release via the manual `release.yml` workflow (version bump + tag); publishing to
npm (with provenance) happens automatically from the tag via `publish.yml`. Contributors don't
need to touch versions.

## Security issues

Please follow [SECURITY.md](SECURITY.md) — do not open public issues for vulnerabilities.
