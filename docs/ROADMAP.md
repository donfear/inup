# inup — Roadmap

Rewritten **2026-07-06** from a code audit of `v1.6.7`. The previous multi-file roadmap
(`docs/roadmap/`, dated 2026-05-30) is retired: its critical path — headless mode, keymap-as-data,
the vulnerability-fix verdict, pnpm catalogs, `.npmrc`/private-registry support, 100% coverage,
Biome — **shipped**. This file records what exists, what's broken, and what's next. It describes
intent, not promises; when it disagrees with the code, the code wins.

## Where inup stands (verified against source)

- Interactive TUI with a keymap single-source-of-truth (`src/features/interactive/keymap.ts`)
  that generates the README table and is asserted by tests.
- Headless modes: `--json`, `--check` (exit-code contract), `--apply --target`.
- Registry client with the full `.npmrc` auth chain, scoped/private registries, on-disk ETag
  cache, adaptive concurrency (`src/shared/registry/`, `src/shared/http/`).
- Vulnerability audit with fixed-by-range/fixed-by-latest verdicts (`src/features/audit/`).
- Changelog/release notes in the TUI — GitHub-hosted packages only (`src/features/changelog/`).
- Monorepos: pnpm workspaces, npm/yarn/bun `workspaces`, pnpm catalogs with comment-preserving
  write-back (`src/shared/pnpm-catalogs.ts`).
- A Marketplace-published GitHub Action opening a rolling upgrade PR, dogfooded daily
  (`action.yml`, `.github/workflows/inup-self.yml`).
- 100% test coverage enforced on all four metrics; 3-OS CI; npm provenance publishing.

## Now — correctness & trust

| Item | Status |
|---|---|
| `--target patch` must not apply minor bumps | PR [#83](https://github.com/donfear/inup/pull/83) |
| Skip `npm:` aliases and git/tarball URL specifiers in detection | PR [#84](https://github.com/donfear/inup/pull/84) |
| CI: exercise the Node 22.19 engines floor; typecheck step; real `--apply` e2e per package manager | PR [#85](https://github.com/donfear/inup/pull/85) |
| Community files: SECURITY, CONTRIBUTING, issue/PR templates | this PR |
| `rangeVersion` picks the first-published patch of the newest minor (`findClosestMinorVersion` keeps `x.Y.0` when `x.Y.5` exists) — decide and fix | open |

## Next — differentiating features

Ordered by effort-to-differentiation ratio:

1. **Release-age cooldown (supply-chain safety).** Optional minimum age (e.g. "don't offer
   versions younger than 7 days") with per-package exclusions — the policy this repo already
   applies to itself via pnpm's `minimumReleaseAge`. Surface the age in the TUI ("released 2d
   ago"). Needs publish timestamps (registry `time` data) alongside the abbreviated packument.
2. **Patch target in the TUI.** Once headless `patch` is correct, expose a patch-only
   selection state interactively.
3. **Peer-dependency conflict warnings.** Validate selected bumps against sibling packages'
   peer ranges before confirm; badge conflicts. No interactive competitor does this well.
4. **Prerelease/dist-tag opt-in.** `parseVersions` filters to strict `X.Y.Z`; relax behind a
   flag so `next`/`beta` tracks are upgradable.
5. **GitLab changelog support.** The parser stack is host-agnostic; only the fetch layer is
   GitHub-bound (`release-notes-service.ts`).
6. **Bun catalogs.** Bun supports `catalog:`/`catalogs` in package.json workspaces; extend the
   pnpm catalog machinery.
7. **`overrides`/`resolutions` awareness.** Warn when an upgraded package is pinned by an
   override.

## Later — distribution & adoption

- **GitHub Action as the wedge**: auto-merge label for patch-only PRs, grouped-by-workspace
  PRs, schedule presets; a "lighter than Renovate" comparison doc.
- **Docs site** (README + keymap + Action recipes + `--json` schema + `.inuprc` reference);
  publish a JSON Schema for `.inuprc` for editor autocomplete.
- **Comparison content** vs `npm-check-updates`, `taze`, `yarn upgrade-interactive`,
  `pnpm up -i` — inup's real edges: all four package managers, vulnerability verdicts,
  in-TUI changelogs, pnpm catalogs, ETag-cached speed.
- **Homebrew / alternate install channels.**
- **Doctor mode** (long bet): apply upgrades one at a time, run the project's test command,
  auto-revert breakers.
