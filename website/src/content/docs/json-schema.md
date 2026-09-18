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
  schemaVersion: number   // bumped only on a breaking shape change (currently 1)
  summary: {
    total: number         // packages scanned
    outdated: number      // packages with an available update
    major: number         // of the outdated, how many offer a major bump
    vulnerable: number    // of the outdated, how many have ≥1 known advisory on the installed version
  }
  outdated: PackageEntry[]
}
```

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
  "schemaVersion": 1,
  "summary": { "total": 42, "outdated": 3, "major": 1, "vulnerable": 1 },
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
