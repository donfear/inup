---
title: JSON report schema
description: Field-by-field reference for inup's --json output — the versioned headless report, per-package entries, and the vulnerability cross-reference.
order: 55
updated: 2026-07-09
---

`inup --json` prints one JSON document to stdout and exits — read-only, never writing `package.json` or the lockfile. This page is the field-by-field reference for that document; for when to use it and the surrounding `--check` / `--apply` flags, see [CI & scripting](../ci/).

The payload carries a `schemaVersion` so scripts and agents can pin to a known shape. Only the fields documented here are part of the contract; treat anything else as internal.

## Top level

```ts
{
  schemaVersion: number   // bumped only on a breaking shape change (currently 2)
  summary: {
    total: number         // packages scanned
    outdated: number      // packages with an available update
    major: number         // of the outdated, how many offer a major bump
    vulnerable: number    // of the outdated, how many have ≥1 known advisory on the installed version
    heldByCooldown: number // UNIQUE packages with a withheld version (0 when the cooldown is off)
  }
  outdated: PackageEntry[]
  heldByCooldown: CooldownHold[]  // every withheld package, outdated or not
  cooldown?: {                    // present only when a cooldown was configured
    minimumReleaseAge: number     // the window in effect, in minutes
    publishTimesAvailable: boolean // false = the registry exposed no `time`; the cooldown did nothing
  }
}
```

### Checking that the cooldown actually ran

`minimumReleaseAge` fails open: a version with no parsable publish time stays eligible, so a
registry that doesn't expose `time` produces an empty `heldByCooldown` — byte-identical to
"every version is old enough". Gate on `cooldown.publishTimesAvailable`, not on the array being
empty, or an inert control reads as a passing check. inup also writes a warning to stderr in that
case, leaving stdout a pure JSON document.

```bash
inup --json --minimum-release-age 10080 \
  | jq -e '.cooldown.publishTimesAvailable' > /dev/null \
  || echo 'cooldown did not run — registry has no publish times'
```

**Changed in schemaVersion 2.** `summary.heldByCooldown`, the top-level `heldByCooldown` array
and the optional `cooldown` block were added, along with the optional `heldByCooldown` field on
`PackageEntry`. Nothing was removed or renamed, so a `schemaVersion: 1` consumer keeps working.

## `PackageEntry`

One entry per outdated package.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Package name. |
| `current` | `string` | Raw specifier from `package.json`, including the `^`/`~` prefix. |
| `range` | `string` | Newest version that still satisfies `current`'s range (the in-range target). |
| `latest` | `string` | Absolute latest published version. |
| `type` | `string` | One of `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`. |
| `packageJsonPath` | `string` | File the range is declared in — `pnpm-workspace.yaml` for catalog entries. |
| `catalog` | `string?` | Present only for pnpm catalog entries: the catalog name (`default` or a named catalog). |
| `hasMajorUpdate` | `boolean` | `true` when `latest` is a major bump beyond `range`. |
| `deprecated` | `string?` | npm deprecation message for `latest`, if the package is deprecated. |
| `enginesNode` | `string?` | Declared `engines.node` range for `latest`, if any. |
| `vulnerability` | `Vulnerability?` | Present only when the installed version has ≥1 known advisory. |
| `heldByCooldown` | `CooldownHold?` | Present when `minimumReleaseAge` withheld a newer version of this package. |

## `CooldownHold`

What the release-age cooldown withheld. Reported at the **top level** as well as inline, because a package whose only newer versions are inside the window is not outdated — it appears nowhere in `outdated`, and without the top-level array it would be indistinguishable from a package that is genuinely up to date.

The top-level array is a superset: packages that are also outdated appear both there and inline on their `outdated` entry. When the cooldown is disabled the array is empty.

Note the deliberate asymmetry with `summary.heldByCooldown`: the **array** carries one entry per location, like `outdated`, because each names a different file. The **summary count** is of unique package names, because it answers "how many dependencies have something held back" — one package held across five workspaces is one thing to review, not five. In a single-package repo the two always agree.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Package name. Top-level entries only. |
| `type` | `string` | Dependency type. Top-level entries only. |
| `packageJsonPath` | `string` | File the range is declared in. Top-level entries only. |
| `version` | `string` | Newest withheld version — what you would otherwise have been offered. |
| `publishedAt` | `string` | ISO publish timestamp of that version. |
| `ageMinutes` | `number` | How old it was when the scan ran. |
| `eligibleInMinutes` | `number` | Minutes until it clears the window, as of the scan. `0` means the next run will offer it. |
| `count` | `number` | How many versions in total were withheld for this package. |

## `Vulnerability`

Advisories affecting the **currently-installed** version, each cross-referenced against the upgrade targets so you know whether the bump actually clears it.

| Field | Type | Notes |
| --- | --- | --- |
| `count` | `number` | Number of advisories on the installed version. |
| `highestSeverity` | `string` | Highest of `info`, `low`, `moderate`, `high`, `critical`. |
| `fixedByRange` | `boolean` | `true` when the in-range target (`range`) clears **every** advisory. |
| `fixedByLatest` | `boolean` | `true` when upgrading to `latest` clears **every** advisory. |
| `advisories` | `Advisory[]` | The individual advisories. |

### `Advisory`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `number` | npm advisory id. |
| `title` | `string` | Advisory title. |
| `severity` | `string` | `info` \| `low` \| `moderate` \| `high` \| `critical`. |
| `url` | `string` | Link to the advisory. |
| `vulnerableVersions` | `string` | The affected semver range, verbatim from npm. |
| `fixedByRange` | `boolean` | The in-range target is no longer in the affected range. |
| `fixedByLatest` | `boolean` | The latest target is no longer in the affected range. |

## Example

```json
{
  "schemaVersion": 2,
  "summary": { "total": 42, "outdated": 3, "major": 1, "vulnerable": 1, "heldByCooldown": 1 },
  "outdated": [
    {
      "name": "undici",
      "current": "^7.10.0",
      "range": "7.11.0",
      "latest": "7.11.0",
      "type": "dependencies",
      "packageJsonPath": "package.json",
      "hasMajorUpdate": false,
      "vulnerability": {
        "count": 1,
        "highestSeverity": "moderate",
        "fixedByRange": true,
        "fixedByLatest": true,
        "advisories": [
          {
            "id": 1234567,
            "title": "Denial of Service in undici",
            "severity": "moderate",
            "url": "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx",
            "vulnerableVersions": "<7.10.1",
            "fixedByRange": true,
            "fixedByLatest": true
          }
        ]
      }
    },
    {
      "name": "react",
      "current": "^18.2.0",
      "range": "18.3.1",
      "latest": "19.2.0",
      "type": "dependencies",
      "packageJsonPath": "pnpm-workspace.yaml",
      "catalog": "default",
      "hasMajorUpdate": true
    }
  ]
}
```

## Output hygiene & exit codes

With `--json`, stdout carries **only** the JSON document — all progress, warnings, and (under `--apply`) install output go to stderr, so `inup --json | jq` is always safe.

| Exit code | Meaning |
| --- | --- |
| `0` | Up to date |
| `1` | Updates exist (with `--check`) |
| `2` | Error |
