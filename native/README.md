# native/: Rust registry core

A Node-API addon (napi-rs) that takes over the registry client's work off the JS thread. It is on by default (`--no-native`, or `"native": false` in `.inuprc`, turns it off) but not part of inup's npm install: inup downloads it on first use.

It has two capabilities, and inup uses whichever the loaded addon provides:

- **Transport** (`fetchPackument`): one whole registry attempt.
  - Reads the ETag cache and sends a conditional GET (reqwest, HTTP/1, rustls with the OS trust store plus `NODE_EXTRA_CA_CERTS`).
  - Streams and decompresses the body (C brotli, gzip, deflate), parses the packument and writes the cache entry.
  - Returns version data as JSON text, which `JSON.parse` turns into objects far faster than napi can build them.
- **Decoder** (`decodePackument`): decompress, parse and write the cache for a body the JS transport fetched.

Output is byte-identical to the TypeScript path in both cases. Scheduling, retries and the adaptive concurrency controller stay in TypeScript. The controller reads streamed byte counts through `takeReceivedBytes()`.

## How inup gets and uses it

With native on, `src/shared/registry/rust-core.ts` resolves the addon once per process:

1. **Local build:** `native/out/inup.<abi>.node` from `pnpm native:build` (source checkouts). Trusted as it is.
2. **Cached download:** `<user cache>/native/<inup version>/inup.<abi>.node` from an earlier run, only if it matches the pinned hash (below). It is re-hashed before every load, which takes a few milliseconds; a file that doesn't match is deleted and downloaded again.
3. **Neither:** this run uses TypeScript. `src/shared/registry/native-download.ts` fetches the platform package at inup's own version from the configured npm registry, in the background:
   - Registry auth is sent only to the registry origin, including across redirects.
   - The tarball is checked against the registry's sha512 `dist.integrity`.
   - The addon inside must match the pinned hash, or nothing is cached.
   - The addon is extracted, written to the cache atomically, and older cached versions are removed.
   - The next run loads it.

**Pinned hashes.** The registry's integrity only proves the tarball is what that registry serves, and a project's `.npmrc` can point inup at any registry. So every release pins the sha512 of each platform's `.node` file in `src/shared/registry/native-integrity.ts`. `scripts/publish-native.mjs` writes it from the exact addons it publishes, before inup is built, so the pins ship inside the inup tarball that your lockfile already verifies. The pin covers the `.node` file rather than the tarball: that file is what gets cached and loaded, and its hash doesn't depend on how npm packs a tarball.

The file in the repository pins nothing. Builds from source therefore never download a native core: they use `native/out` if you have built it, and TypeScript otherwise.

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
- **Logging:** `inup --debug` logs whether native is enabled, the decoder and transport in use, downloads, and every fallback.

## Platform packages

| Platform | npm package | Addon file inside |
|---|---|---|
| macOS arm64 / x64 | `inup-darwin-arm64` / `inup-darwin-x64` | `inup.darwin-<arch>.node` |
| Linux glibc arm64 / x64 | `inup-linux-arm64-gnu` / `inup-linux-x64-gnu` | `inup.linux-<arch>-gnu.node` |
| Linux musl arm64 / x64 | `inup-linux-arm64-musl` / `inup-linux-x64-musl` | `inup.linux-<arch>-musl.node` |
| Windows arm64 / x64 | `inup-windows-arm64` / `inup-windows-x64` | `inup.win32-<arch>-msvc.node` |

Windows packages don't follow the napi-rs `win32-<arch>-msvc` suffix: npm's spam detection rejects those names. `nativePackageName()` maps the platform suffix to the package name; the addon file keeps the napi-rs name.

## Layout

| Path | What |
|---|---|
| `core/` | Pure Rust: decompression, packument parse (skips everything but `versions`), node-semver strict parse/compare, cache-entry JSON |
| `napi/src/lib.rs` | Node-API surface: `abiVersion()`, `decodePackument()` |
| `napi/src/http.rs` | Native transport: `fetchPackument()`, `cancelFetch()`, `takeReceivedBytes()` |
| `../src/shared/registry/rust-core.ts` | On/off switch, host detection, addon resolution with TypeScript fallback, pinned-hash check of the cached addon |
| `../src/shared/registry/native-download.ts` | Download, verification and caching of the platform addon |
| `../src/shared/registry/native-integrity.ts` | Pinned hash of each platform's addon; empty in the repository, generated at release |

## Develop

Requirements: a Rust toolchain (`rustup`), then `pnpm install`.

```sh
pnpm native:check    # cargo fmt --check, clippy -D warnings, cargo test
pnpm native:build    # native/out/inup.<abi>.node for this machine
pnpm build:all       # native addon + CLI (dist/) in one go
pnpm test            # includes the parity suite once the addon is built
```

To try it from a source checkout, run `pnpm build:all`, then `node dist/cli.js`: it loads the addon from `native/out`. Without that build a source checkout stays on TypeScript, because it pins no addon to download.

To change a binding's signature or result shape, bump `ABI_VERSION` in `core/src/lib.rs` and `CORE_ABI_VERSION` in `rust-core.ts` together.

## Tests

- `cargo test` covers encodings, semver precedence and grammar, JSON edge cases, cache-entry escaping, and the ABI constant.
- `test/unit/shared/registry/rust-core.test.ts` covers host detection, resolution order, the pinned-hash check of the cached addon and every fallback, using stub modules. It runs everywhere.
- `test/unit/shared/registry/rust-core.parity.test.ts` loads the real addon through the loader and checks it against `parseVersions` / `writeEtag` in every encoding.
- `test/unit/shared/registry/rust-transport.parity.test.ts` runs the real transport against a local HTTP server. It covers every encoding, ETag + 304, all status classes and Retry-After, header timeouts, refused connections, undecodable bodies, TLS failure (which must return `fallback`), and cancellation.
  - It is skipped when the addon isn't built.
  - `INUP_PARITY_REQUIRED=1` turns that skip into a failure.

## CI and release

- **Pull requests** (`ci.yml`) run the Rust checks and build the addon for all 8 platforms via `native-build.yml`. Each build is smoke-tested on its own platform by `native/scripts/smoke.cjs`, which covers decoding, the cache write, a real request through the Rust HTTP stack, and TLS-failure classification. Linux builds are checked to need at most glibc 2.28. The parity suites then run against the real addons on Linux, macOS and Windows. All 8 platform packages are assembled in a publish dry run, which also pins their hashes and checks that the rebuilt inup carries a pin for every platform.
- **Releases** (`publish.yml`) repeat the build and publish the platform packages. They then rebuild `inup` with the pinned hashes, publish it, and run `verify-published.yml`, which installs the release on every platform and requires `--native` to download and then use the core.
- **Procedure:** release candidates, retries and rollback are in [docs/releasing.md](../docs/releasing.md#native-core-packages).

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
