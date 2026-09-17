# native/: Rust registry core

A Node-API addon (napi-rs) that takes over the registry client's work off the JS thread. It has two capabilities, and inup uses whichever the loaded addon provides:

- **Transport** (`fetchPackument`): one whole registry attempt.
  - Reads the ETag cache and sends a conditional GET (reqwest, HTTP/1, rustls with the OS trust store plus `NODE_EXTRA_CA_CERTS`).
  - Streams and decompresses the body (C brotli, gzip, deflate), parses the packument and writes the cache entry.
  - Returns version data as JSON text, which `JSON.parse` turns into objects far faster than napi can build them.
- **Decoder** (`decodePackument`): decompress, parse and write the cache for a body that undici fetched.

Output is byte-identical to the TypeScript path in both cases. Scheduling, retries and the adaptive concurrency controller stay in TypeScript. The controller reads streamed byte counts through `takeReceivedBytes()`.

## How inup uses it

`src/shared/registry/rust-core.ts` resolves the addon once per process:

1. the installed `inup-<abi>` platform package (e.g. `inup-darwin-arm64`, `inup-linux-x64-musl`)
2. a local build at `native/out/inup.<abi>.node` (source checkouts)
3. otherwise the TypeScript path, exactly as before

Each registry attempt then takes the first path that works:

| Situation | Path |
|---|---|
| Addon with transport loaded | native transport |
| The native transport reported a TLS failure or internal error for this origin earlier in the run | undici + native decoder, for that origin |
| Addon loaded but decode-only (no transport exports) | undici + native decoder |
| No usable addon, or `INUP_CORE=js` | undici + TypeScript, unchanged |

What happens when something goes wrong:
- **Native decoder fails on a body:** that body is decoded again in TypeScript.
- **Rust panic:** caught and reported as a fallback.
- **Cancellation:** the TUI's abort signal cancels in-flight native requests.
- **Dev link emulation** (`INUP_PACE_BPS`) always uses undici.
- **Logging:** `inup --debug` logs the decoder and transport in use, and every fallback.

## Layout

| Path | What |
|---|---|
| `core/` | Pure Rust: decompression, packument parse (skips everything but `versions`), node-semver strict parse/compare, cache-entry JSON |
| `napi/src/lib.rs` | Node-API surface: `abiVersion()`, `decodePackument()` |
| `napi/src/http.rs` | Native transport: `fetchPackument()`, `cancelFetch()`, `takeReceivedBytes()` |
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
- `test/unit/shared/registry/rust-transport.parity.test.ts` runs the real transport against a local HTTP server. It covers every encoding, ETag + 304, all status classes and Retry-After, header timeouts, refused connections, undecodable bodies, TLS failure (which must return `fallback`), and cancellation.
  - It is skipped when the addon isn't built.
  - `INUP_PARITY_REQUIRED=1` turns that skip into a failure.

## Measured impact

Apple Silicon, Node 24, a 17-workspace public monorepo (319 dependencies), `inup --json`, median of 3 runs:

| Cold run (empty cache) | TypeScript | undici + native decoder | native transport |
|---|---|---|---|
| Wall | 7.97 s | 6.93 s | 6.86 s |
| CPU | 4.92 s | 2.78 s | 2.30 s |
| JS-thread busy (CPU profile) | 3149 ms | 1209 ms | 615 ms |
| Peak RSS | 402 MB | 301 MB | 288 MB |

Warm runs (all `304`) take about 1.5–1.9 s on every path; the gap is within noise. Wall time is bound by download speed. The gain is CPU, memory, and a JS thread that stays free for the TUI while packages load.
