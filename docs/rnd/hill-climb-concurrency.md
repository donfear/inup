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
| throttled, cold | `firstBatch` | ≥30% faster |
| throttled, cold | pkg latency p95 | ≥2× lower |
| throttled, cold | `registryFetch` | ≤ +10% (expect equal or better) |
| throttled | settled limit | ≤ 8 |
| fast link | `registryFetch` | within ±5% |
| fast link | ramp | limit 24 within ≤3 ticks, zero down decisions |
| all arms | `failed` count | 0 |
| sanity | hillclimb ≈ best fixed arm per condition | fixed4 when throttled, fixed24 when fast |

## Known limitations / follow-ups

- One global profile, not keyed by registry origin (VPN/private registries
  share it).
- The `npm install` phase is `spawnSync` in the package manager — this work
  does not touch it; a frozen spinner during install is a separate fix
  (async spawn + live progress).
- `ControlTick` exists in two structural copies
  (`src/shared/http/adaptive-controller.ts` and `src/features/debug/types.ts`);
  edit both.
