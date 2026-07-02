# reach — Distribution: onboarding & release automation

> The npm side is already strong — provenance-signed publish, and the release step already
> auto-generates GitHub notes ([publish.yml:50](../../.github/workflows/publish.yml#L50)). So this
> phase is narrow: fill the *onboarding* gap (so others can contribute) and the *trigger* gap (so
> releases don't need a manual button press). It sits last on the critical path — reach matters most
> once the product underneath is worth reaching for.

See the [legend](README.md#legend) for rating definitions.

## Onboarding docs

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 1 | **`CONTRIBUTING.md` + architecture overview** | 🔴 | S | 0.5–1d | One onboarding pass. Document the existing scripts (`build`, `test`, `format`, `link`, `version:*`) and the `workflow_dispatch` publish flow, plus a short layer diagram: [cli.ts](../../src/cli.ts) → [core/](../../src/features/upgrade/) → [ui/](../../src/features/interactive/) → [services/](../../src/shared/). The cheapest unblock for outside PRs. |
| 2 | **Document `.inuprc` + the `s` audit in the README** | 🟡 | S | 0.5d | The config keys `ignore` / `exclude` / `showPeerDependencyVulnerabilities` / `showOptionalDependencyVulnerabilities` live in [project-config.ts:8-30](../../src/shared/config/project-config.ts#L8-L30) but aren't documented. *(The keyboard section is now **generated** from the keymap, [03](03-trust-and-ux.md) #4 — this covers the config/audit prose that isn't auto-generated.)* |

## Release automation

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 3 | **Auto-publish on tag push** (replace manual `workflow_dispatch`) | 🟡 | M | 1d | [publish.yml](../../.github/workflows/publish.yml) triggers only via `workflow_dispatch` with a tag input; the `version:*` scripts already push tags, so make `v*` tags fire the publish directly, keeping provenance signing. **Note:** GitHub release notes are *already* auto-generated (`generate_release_notes: true`), so a separate conventional-commits changelog generator is **largely redundant** — don't schedule it as its own task. |

## Reach (genuinely nice-to-have — weight last)

| # | Task | Value | Cx | Effort | Notes / reuse |
|---|---|:--:|:--:|---|---|
| 4 | **Refresh the demo content** | 🟢 | S | 0.5–1d | Recording tooling already exists in [docs/demo](../../docs/demo). The best new clips are the things that don't exist yet — record the `?` overlay and Risk Score *after* [P2](03-trust-and-ux.md)/[P3](04-intelligence.md) ship them. |
| 5 | **Alt install channels** (self-update / Homebrew / Docker) | 🟢 | M | — | An update *check* already exists ([cli.ts:73](../../src/cli.ts#L73)); a guided `--upgrade-self`, a Homebrew tap, and a tiny `node:alpine` image broaden reach. **npm + npx already covers the large majority of users** — build any of these only if demand appears. |

## Sequencing notes

- **#1 first.** Onboarding docs are the cheapest contributor unblock.
- **#3** is the one automation worth doing; it pairs with nothing because the changelog half is
  already solved.
- **#4–#5 are deliberately last** and demand-gated.
