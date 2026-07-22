#!/usr/bin/env python3
"""Summarize hill-climb A/B perf runs written by scripts/hill-climb-experiment.sh.

Groups .inup-perf run files by arm (controllerMode / pinnedConcurrency) and
reports the metrics the experiment is judged on: time-to-first-batch (the UX
complaint), total registry-fetch time, wall time, per-package latency p50/p95,
the settled concurrency limit, and failure counts.

Usage: python3 scripts/analyze-hill-climb.py [.inup-perf] [--since ISO8601]
"""

import argparse
import json
import statistics
from pathlib import Path


def arm_of(record: dict) -> str:
    cfg = record.get("config", {})
    pinned = cfg.get("pinnedConcurrency")
    if pinned is not None:
        return f"fixed{pinned}"
    return cfg.get("controllerMode") or "aimd"


def pct(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, round(p * (len(ordered) - 1))))
    return ordered[k]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("perf_dir", nargs="?", default=".inup-perf", type=Path)
    parser.add_argument("--since", help="only include runs at or after this ISO8601 timestamp")
    parsed = parser.parse_args()
    perf_dir = parsed.perf_dir
    since = parsed.since

    groups: dict[str, list[dict]] = {}
    for path in sorted(perf_dir.glob("run-*.json")):
        try:
            record = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if since and record.get("timestamp", "") < since:
            continue
        groups.setdefault(arm_of(record), []).append(record)

    if not groups:
        print(f"no run files in {perf_dir}")
        return

    header = (
        f"{'arm':<10} {'n':>3} {'firstBatch':>11} {'regFetch':>9} {'wall':>7} "
        f"{'pkg p50':>8} {'pkg p95':>8} {'settle':>7} {'downs':>6} {'fail':>5}"
    )
    print(header)
    print("-" * len(header))
    for arm in sorted(groups):
        records = groups[arm]
        first = [r["snapshot"]["phases"].get("firstBatch") for r in records]
        first = [v for v in first if v is not None]
        fetch = [r["snapshot"]["phases"].get("registryFetch") for r in records]
        fetch = [v for v in fetch if v is not None]
        wall = [r.get("wallMs") for r in records if r.get("wallMs") is not None]
        latencies = [
            t["latencyMs"] for r in records for t in r["snapshot"].get("packageTimings", [])
        ]
        settles = [
            r["snapshot"]["controlTicks"][-1]["limit"]
            for r in records
            if r["snapshot"].get("controlTicks")
        ]
        downs = sum(
            1
            for r in records
            for t in r["snapshot"].get("controlTicks", [])
            if t["reason"] in ("step-down", "revert", "soft-down", "hard-down")
        )
        failed = sum(r["snapshot"].get("counts", {}).get("failed", 0) for r in records)

        fmt = lambda vals: f"{statistics.median(vals):.0f}" if vals else "—"
        print(
            f"{arm:<10} {len(records):>3} {fmt(first):>11} {fmt(fetch):>9} {fmt(wall):>7} "
            f"{pct(latencies, 0.5):>8.0f} {pct(latencies, 0.95):>8.0f} "
            f"{fmt(settles):>7} {downs:>6} {failed:>5}"
        )
    print("\nmedians per arm; latency percentiles pooled across runs. ms everywhere.")


if __name__ == "__main__":
    main()
