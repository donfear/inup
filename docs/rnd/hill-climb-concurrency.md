# R&D: slow-start + hill-climb registry concurrency

Branch: `rnd/hill-climb-concurrency`. Status: implemented, experiment pending.

## Problem

On a slow-but-healthy connection the AIMD controller never backs off — it only
reacts to 429/503 and network errors — so it pins concurrency at the pool
ceiling (24) and splits a narrow pipe across 24 sockets. The user sees
`Loading packages…` sit frozen. Latency was deliberately excluded from AIMD
decisions after it caused oscillation on healthy links (npm's CDN jitters).

## What this branch adds

- **`HillClimbController`** (`src/shared/http/hill-climb-controller.ts`):
  passive goodput measurement (completions/sec per 12-completion window) on the
  requests we already make — zero probes, zero extra traffic. Slow-start
  doubling from 4 while a doubling buys ≥25%, ±1 hill-climb to the goodput
  knee, HOLD with asymmetric hysteresis, occasional upward re-probes.
  Congestion/retry semantics inherited from AIMD unchanged. Latency decides
  nothing except the start-of-run regime check (3× baseline AND ≥500ms).
- **Learned `NetworkProfile`** persisted in the user config (7-day expiry):
  the next run starts at the learned limit as a *hypothesis* — validated
  against live latency; a changed network resets to cold start. Runs too small
  for the controller still use the learned limit as their fixed start.
- **`--concurrency N` / `.inuprc "concurrency"`**: manual pin, disables all
  adaptation. Precedence: flag > .inuprc > learned profile > cold default.
- **UI**: loading line shows `— slow connection, reduced parallelism`;
  performance modal (`p`) shows controller arm, state, and last goodput.

Env toggles (all captured in perf logs): `INUP_CONTROLLER=aimd|hillclimb`
(arm selector, default hillclimb), `INUP_NET_PROFILE=0` (disable profile
read+write), `INUP_ADAPTIVE=0` (fixed limit, legacy).

## Experiment protocol

Prereqs: `pnpm build`; a target project with 100+ unique dependencies.

1. **Throttle the link** (system-wide — undici connects directly, an HTTP
   proxy would not be honored):
   - Network Link Conditioner (Xcode "Additional Tools" dmg → prefpane).
     Custom profile "inup-slow": 1 Mbps down / 256 kbps up / 150 ms delay /
     0.5% loss. Also test the built-in "3G" profile.
   - Scriptable alternative:
     `sudo dnctl pipe 1 config bw 1Mbit/s delay 150` plus a pf rule routing
     port-443 traffic through pipe 1.
2. **Run the arms, interleaved** (5 reps each of aimd / hillclimb /
   fixed 4 / 10 / 24), cold and warm ETag cache:

   ```sh
   scripts/hill-climb-experiment.sh ~/path/to/big-project 5 cold
   scripts/hill-climb-experiment.sh ~/path/to/big-project 5 warm
   ```

3. **Repeat unthrottled** (fast-link regression check).
4. **Persistence run** (separate, throttled, without `INUP_NET_PROFILE=0`):
   run twice throttled — the second run must start at the learned limit —
   then once unthrottled — the regime check must reset and re-climb.
5. **Analyze**: `python3 scripts/analyze-hill-climb.py .inup-perf`
   (use `--since <ISO>` to scope to today's runs).

## Success criteria

| Condition | Metric | Target vs `aimd` arm |
| --- | --- | --- |
| throttled, cold | `firstResult` (`firstBatch` before perf schema 2) | ≥30% faster |
| throttled, cold | pkg latency p95 | ≥2× lower |
| throttled, cold | `registryFetch` | ≤ +10% (expect equal or better) |
| throttled | settled limit | ≤ 8 |
| fast link | `registryFetch` | within ±5% |
| fast link | ramp | limit 24 within ≤3 ticks, zero down decisions |
| all arms | `failed` count | 0 |
| sanity | hillclimb ≈ best fixed arm per condition | fixed4 when throttled, fixed24 when fast |

## Review hardening (adversarial pass, 2026-07-21)

- Regime check is cache-mix-safe: both the persisted `baselineLatencyMs` and
  the live comparison use FULL-fetch latency only (304s are fast on any link
  and used to be able to fake a regime change in either direction). All-304
  runs persist no baseline; validation that cannot gather 8 full fetches in
  2 windows gives up and trusts the learned limit.
- Validation survives errorful windows (soft-down applies, check continues);
  a stale pre-error revert point can no longer cause multi-slot jumps.
- Windows with a non-advancing clock (`Date.now()` is not monotonic) or
  straddling a hard-down are discarded, never measured. Error windows
  soft-decrease regardless of timing.
- Profile `sampleCount` counts successes only; config writes are atomic
  (write-then-rename); future `updatedAt` cannot defeat expiry.
- `slowNetwork` now actually reaches the TUI (the runner dropped it), and the
  loading-line hint is dropped before it can wrap a narrow terminal.
- Experiment kit: ETag cache dir resolved via env-paths (the hardcoded path
  made "cold" runs silently warm), priming run no longer writes a profile,
  analyzer uses argparse.

## Known limitations / follow-ups

- One global profile, not keyed by registry origin (VPN/private registries
  share it).
- The `npm install` phase is `spawnSync` in the package manager — this work
  does not touch it; a frozen spinner during install is a separate fix
  (async spawn + live progress).
- `ControlTick` exists in two structural copies
  (`src/shared/http/adaptive-controller.ts` and `src/features/debug/types.ts`);
  edit both.

## Cold-run collapse and the bytes metric (2026-09-12)

Field finding on a fast link (~110 Mbit/s), 190-package project, empty ETag
cache: adaptive runs took 8.7 / 9.2 / 13.5 / 20.5 / 24.2 s where
`--concurrency 24` took 4.4–4.7 s and a bare download of the same 47.5 MB of
brotli packuments at 24 connections took 3.6 s. The limit went 8 → 4 → 3 and
stayed there in 5 of 5 runs.

Cause: goodput was completions per second over 12-completion windows, but cold
responses span 0 KB–4.2 MB (p50 79 KB; the ten largest packages carry 55% of the
bytes). The measured windows held 0.7 MB, then 5.6 MB, then 16.5 MB of body:
completions/sec fell 7 → 5.5 → 4.2 purely because bigger packages finished
later, so the doubling was "reverted" and the count-down began. In bytes/sec
the same windows read 0.4 → 2.6 → 5.7 MB/s. Warm windows are uniform 304s,
which is why the original experiment never saw it.

Fix (`HillClimbController`):

- Response bodies are streamed and their bytes fed to the controller as they
  arrive (`recordBytes`). A window with < 50% revalidations is measured in
  bytes/sec; a mostly-304 window keeps completions/sec. A metric switch
  between consecutive windows is non-comparable, like a cache-mix shift.
- **Fast link:** whenever a clean window streams ≥ `fastLinkBytesPerSec`
  (1 MB/s, 8× the 1 Mbit/s profile above), the limit is held at the ceiling
  for the run and no goodput decision is made. Soft-down (errors) and
  hard-down (429/503) clear it and suppress re-engagement for 2 and 6 windows
  respectively, so a registry back-off is honored.
- `INUP_FASTLINK=0` disables the rule; `INUP_PACE_BPS=<bytes/s>` paces chunks
  in-process, replacing the Link Conditioner prerequisite for the throttled
  arms above (bandwidth sharing only — not RTT or loss).

Prototype results before landing (medians of interleaved runs):

| condition | before | after | pinned 24 |
| --- | --- | --- | --- |
| cold, 190 pkgs | 8.7–24.2 s | 4.9–5.1 s | 4.4–4.7 s |
| half-warm (50% of ETag entries) | 3.4 / 5.9 s | 3.0 / 3.4 s | – |
| warm | 1.6–2.1 s | 1.6–1.8 s | – |
| cold, 164 pkgs | 3.9 / 6.2 s | 3.9 / 4.4 s | 4.05 s |
| `INUP_PACE_BPS=500000`, cold | 103 s, first result 1.4 s, settled 4 | 101 s, first result 0.5 s, settled 8 | – |

Known limitation: on a bandwidth-bound pipe bytes/sec is flat, so HOLD never
counts down and the knee lands near 8 rather than 4 (p95 latency higher than
the accidental collapse, total time equal). A probe-down in HOLD would close
that; evaluate with the pacer.
