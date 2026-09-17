# native/: Rust registry decoder

A Node-API addon (napi-rs) that does the registry client's work for a `200` response: decompress (C brotli, gzip, deflate), parse the packument, and write the ETag cache entry. All of it runs on the libuv thread pool. Output is byte-identical to the TypeScript path it replaces.

## How inup uses it

`src/shared/registry/rust-core.ts` resolves a decoder once per process:

1. the installed `inup-<abi>` platform package (e.g. `inup-darwin-arm64`, `inup-linux-x64-musl`)
2. a local build at `native/out/inup.<abi>.node` (source checkouts)
3. otherwise the TypeScript path, exactly as before

inup never fails because of the addon:
- **Missing or foreign addon:** it is skipped.
- **Different `abiVersion()`:** it is skipped.
- **Decode fails on a response:** that response is retried in TypeScript.
- **Rust panic:** caught and handled the same way.

`inup --debug` logs which decoder is active. `INUP_CORE=js` forces TypeScript; it's for development only.

## Layout

| Path | What |
|---|---|
| `core/` | Pure Rust: decompression, packument parse (skips everything but `versions`), node-semver strict parse/compare, cache-entry JSON |
| `napi/` | Node-API surface: `abiVersion()`, `decodePackument()` |
| `../src/shared/registry/rust-core.ts` | Host detection and addon resolution, falling back to TypeScript |

## Develop

Requirements: a Rust toolchain (`rustup`), then `pnpm install`.

```sh
pnpm native:check    # cargo fmt --check, clippy -D warnings, cargo test
pnpm native:build    # native/out/inup.<abi>.node for this machine
pnpm test            # includes the parity suite once the addon is built
```

To change a binding's signature or result shape, bump `ABI_VERSION` in `core/src/lib.rs` and `CORE_ABI_VERSION` in `rust-core.ts` together.

## Tests

- `cargo test` covers encodings, semver precedence and grammar, JSON edge cases, cache-entry escaping, and the ABI constant.
- `test/unit/shared/registry/rust-core.test.ts` covers host detection, resolution order and every fallback, using stub modules. It runs everywhere.
- `test/unit/shared/registry/rust-core.parity.test.ts` loads the real addon through the loader and checks it against `parseVersions` / `writeEtag` in every encoding.
  - It is skipped when the addon isn't built.
  - `INUP_PARITY_REQUIRED=1` turns that skip into a failure.

## Measured impact

Apple Silicon, Node 24, a 527-dependency monorepo, median of 3 runs:

| | TypeScript | native |
|---|---|---|
| Cold run, wall | 6.75 s | 5.96 s |
| Cold run, CPU | 4.4 s | 2.61 s |
| Cold run, peak RSS | 423 MB | 265 MB |
| Cold run, JS-thread busy (CPU profile) | 3083 ms | 875 ms |
| Warm run, wall | 1.53 s | 1.5 s |

On 319 real packuments decoded 24 at a time, the longest event-loop stall drops from ~100 ms to ~2 ms. Wall time barely moves: cold runs are bound by download speed, and warm runs get `304`s with nothing to parse. The gain is CPU, memory, and a responsive TUI while packages load.
