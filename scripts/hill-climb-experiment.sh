#!/usr/bin/env bash
# A/B experiment runner for the hill-climb concurrency controller (R&D).
#
# Runs interleaved arms against a target project and collects perf JSONs into
# .inup-perf/ (in this repo). Interleaving A,B,A,B controls for time-varying
# network and npm CDN cache warmth; blocking all A runs before all B runs would
# confound arm with time.
#
# Arms:
#   aimd       INUP_CONTROLLER=aimd        (current main behavior)
#   hillclimb  default                     (this branch)
#   fixed4     --concurrency 4             (fixed reference, slow-link floor-ish)
#   fixed10    --concurrency 10            (legacy default reference)
#   fixed24    --concurrency 24            (pool-ceiling reference)
#
# Usage:
#   scripts/hill-climb-experiment.sh <target-project-dir> [reps=5] [cold|warm]
#
# cold: the per-user ETag cache is wiped before every run (every packument
#       re-downloads). warm: one unmeasured priming run first, then measure —
#       the common real-world case, dominated by 304 revalidations.
#
# Throttle the link with Network Link Conditioner (or dummynet) around this
# script; see docs/rnd/hill-climb-concurrency.md for profiles and analysis.

set -euo pipefail

TARGET_DIR=${1:?usage: hill-climb-experiment.sh <target-project-dir> [reps] [cold|warm]}
REPS=${2:-5}
CACHE_MODE=${3:-cold}

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
PERF_DIR="$REPO_DIR/.inup-perf"
CLI="$REPO_DIR/dist/cli.js"

[ -f "$CLI" ] || { echo "dist/cli.js missing — run 'pnpm build' first" >&2; exit 1; }

# Resolve the ETag cache dir through env-paths itself — the only source of
# truth (it appends a "-nodejs" suffix; hardcoding the path once made every
# "cold" rep silently warm because rm -rf deleted a directory that never
# existed).
ETAG_CACHE=$(cd "$REPO_DIR" && node --input-type=module -e \
  "import envPaths from 'env-paths'; console.log(envPaths('inup').cache)")/etag-cache
[ -n "$ETAG_CACHE" ] || { echo "failed to resolve the ETag cache dir" >&2; exit 1; }
echo "ETag cache: $ETAG_CACHE"

ARMS=(aimd hillclimb fixed4 fixed10 fixed24)

run_arm() {
  local arm=$1
  local args=(--check --dir "$TARGET_DIR")
  local env=(INUP_PERF=1 "INUP_PERF_DIR=$PERF_DIR" INUP_NET_PROFILE=0)
  case "$arm" in
    aimd) env+=(INUP_CONTROLLER=aimd) ;;
    hillclimb) ;;
    fixed4) args+=(--concurrency 4) ;;
    fixed10) args+=(--concurrency 10) ;;
    fixed24) args+=(--concurrency 24) ;;
  esac
  if [ "$CACHE_MODE" = cold ]; then
    rm -rf "$ETAG_CACHE"
  fi
  # --check exits 1 when updates exist — that is the expected outcome, not a failure.
  env "${env[@]}" node "$CLI" "${args[@]}" >/dev/null 2>&1 || true
}

if [ "$CACHE_MODE" = warm ]; then
  echo "priming ETag cache..."
  # INUP_NET_PROFILE=0 here too: a priming run on a throttled link must not
  # persist a slow-link profile into the user's real config for the next week.
  INUP_NET_PROFILE=0 node "$CLI" --check --dir "$TARGET_DIR" >/dev/null 2>&1 || true
fi

for rep in $(seq 1 "$REPS"); do
  for arm in "${ARMS[@]}"; do
    echo "rep $rep/$REPS  arm=$arm  cache=$CACHE_MODE"
    run_arm "$arm"
  done
done

echo "done — analyze with: python3 scripts/analyze-hill-climb.py $PERF_DIR"
