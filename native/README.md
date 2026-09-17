# native/: Rust registry core

A Node-API addon (napi-rs) that takes over the registry client's work off the JS thread. It is **opt-in** (`--native`, or `"native": true` in `.inuprc`) and not part of inup's npm install.

It has two capabilities, and inup uses whichever the loaded addon provides:

- **Transport** (`fetchPackument`): one whole registry attempt.
  - Reads the ETag cache and sends a conditional GET (reqwest, HTTP/1, rustls with the OS trust store plus `NODE_EXTRA_CA_CERTS`).
  - Streams and decompresses the body (C brotli, gzip, deflate), parses the packument and writes the cache entry.
  - Returns version data as JSON text, which `JSON.parse` turns into objects far faster than napi can build them.
- **Decoder** (`decodePackument`): decompress, parse and write the cache for a body the JS transport fetched.

Output is byte-identical to the TypeScript path in both cases. Scheduling, retries and the adaptive concurrency controller stay in TypeScript. The controller reads streamed byte counts through `takeReceivedBytes()`.

## How inup gets and uses it

Default runs never load or download anything native. With native enabled, `src/shared/registry/rust-core.ts` resolves the addon once per process:

1. **Local build:** `native/out/inup.<abi>.node` from `pnpm native:build` (source checkouts).
2. **Cached download:** `<user cache>/native/<inup version>/inup.<abi>.node` from an earlier run.
3. **Neither:** this run uses TypeScript. `src/shared/registry/native-download.ts` fetches the `inup-<abi>` package at inup's own version from the configured npm registry, in the background:
   - Registry auth is sent only to the registry origin, including across redirects.
   - The tarball is checked against the registry's sha512 `dist.integrity`.
   - The addon is extracted, written to the cache atomically, and older cached versions are removed.
   - The next run loads it.

Each registry attempt then takes the first path that works:

| Situation | Path |
|---|---|
| Addon with transport loaded | native transport |
| The native transport reported a TLS failure or internal error for this origin earlier in the run | JS transport + native decoder, for that origin |
| Addon loaded but decode-only (no transport exports) | JS transport + native decoder |
| Native off, not downloaded yet, or unsupported platform | JS transport + TypeScript, unchanged |

The JS transport is Node's built-in `http`/`https` (`src/shared/http/http-request.ts`); inup has no HTTP client dependency.

What happens when something goes wrong:
- **Native decoder fails on a body:** that body is decoded again in TypeScript.
- **Rust panic:** caught and reported as a fallback.
- **Cancellation:** the TUI's abort signal cancels in-flight native requests.
- **Dev link emulation** (`INUP_PACE_BPS`) always uses the JS transport.
- **Logging:** `inup --debug` logs whether native is enabled, the decoder and transport in use, downloads, and every fallback.

## Layout

| Path | What |
|---|---|
| `core/` | Pure Rust: decompression, packument parse (skips everything but `versions`), node-semver strict parse/compare, cache-entry JSON |
| `napi/src/lib.rs` | Node-API surface: `abiVersion()`, `decodePackument()` |
| `napi/src/http.rs` | Native transport: `fetchPackument()`, `cancelFetch()`, `takeReceivedBytes()` |
| `../src/shared/registry/rust-core.ts` | Opt-in switch, host detection, addon resolution with TypeScript fallback |
| `../src/shared/registry/native-download.ts` | Download, verification and caching of the platform addon |

## Develop

Requirements: a Rust toolchain (`rustup`), then `pnpm install`.

```sh
pnpm native:check    # cargo fmt --check, clippy -D warnings, cargo test
pnpm native:build    # native/out/inup.<abi>.node for this machine
pnpm test            # includes the parity suite once the addon is built
```

To test the opt-in flow from a source checkout, build first (`pnpm native:build`) and run `node dist/cli.js --native`.

To change a binding's signature or result shape, bump `ABI_VERSION` in `core/src/lib.rs` and `CORE_ABI_VERSION` in `rust-core.ts` together.

## Tests

- `cargo test` covers encodings, semver precedence and grammar, JSON edge cases, cache-entry escaping, and the ABI constant.
- `test/unit/shared/registry/rust-core.test.ts` covers host detection, resolution order and every fallback, using stub modules. It runs everywhere.
- `test/unit/shared/registry/rust-core.parity.test.ts` loads the real addon through the loader and checks it against `parseVersions` / `writeEtag` in every encoding.
- `test/unit/shared/registry/rust-transport.parity.test.ts` runs the real transport against a local HTTP server. It covers every encoding, ETag + 304, all status classes and Retry-After, header timeouts, refused connections, undecodable bodies, TLS failure (which must return `fallback`), and cancellation.
  - It is skipped when the addon isn't built.
  - `INUP_PARITY_REQUIRED=1` turns that skip into a failure.

## Measured impact

Apple Silicon, Node 24, a 17-workspace public monorepo (319 dependencies), `inup --json`, median of 3 interleaved runs:

| Cold run (empty cache) | undici + TypeScript (before) | Node http + TypeScript | Node http + native decoder | native transport |
|---|---|---|---|---|
| Wall | 7.33 s | 7.08 s | 7.22 s | 7.71 s* |
| CPU | 4.73 s | 4.73 s | 2.83 s | 2.43 s |
| JS-thread busy (CPU profile) | 2677 ms | 3031 ms | 1069 ms | 530 ms |
| Peak RSS | 463 MB | 435 MB | 324 MB | 328 MB |

\* One of the three native-transport runs hit a 13 s network stall; the other two took 7.17 s and 7.71 s. Wall time is bound by download speed on every path.

Warm runs (all `304`) take 1.5–1.7 s on every path. Replacing undici with Node's built-in `http` costs nothing measurable. The native core's gain is CPU, memory, and a JS thread that stays free for the TUI while packages load.
