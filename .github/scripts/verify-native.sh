#!/usr/bin/env bash
# Install a published inup the way users do and require its native core to work:
# the first opt-in run downloads and verifies the core, the next one must use it.
#
#   verify-native.sh <version> [npm|pnpm|bun]
set -euo pipefail
version="$1"
pm="${2:-npm}"
# What to install; a local tarball can stand in for the registry version when testing this script.
spec="${INUP_INSTALL_SPEC:-inup@$version}"

work="$(mktemp -d)"
cd "$work"
printf '{"name":"verify-native","private":true,"dependencies":{"semver":"7.0.0"}}\n' > package.json

case "$pm" in
  npm) npm install --no-audit --no-fund "$spec" ;;
  pnpm) npx -y pnpm@latest add "$spec" ;;
  bun) bun add "$spec" ;;
  *) echo "unknown package manager: $pm"; exit 2 ;;
esac

# A cache nobody has used: the download must happen here, not come from a
# previous run. env-paths reads these per platform.
cache="$work/cache-home"
mkdir -p "$cache"
export HOME="$cache" XDG_CACHE_HOME="$cache/.cache" LOCALAPPDATA="$cache/AppData/Local"

node - <<'JS'
const path = require('node:path')
const root = path.dirname(require.resolve('inup/package.json', { paths: [process.cwd()] }))
const core = require(path.join(root, 'dist/shared/registry/rust-core.js'))
const logger = require(path.join(root, 'dist/shared/debug-logger.js'))
logger.enableDebugLogging()

const fail = (message) => {
  console.error(message)
  const log = logger.getDebugLogPath()
  if (log) console.error(require('node:fs').readFileSync(log, 'utf8'))
  process.exit(1)
}

;(async () => {
  core.configureNativeCore({ enabled: true })
  const first = core.activeCore()
  const download = core.nativeCoreDownload()
  if (!download) fail(`first opt-in run started no download (core: ${first})`)
  await download

  // A new process would re-resolve; reset this one to do the same.
  core.setRustCoreEnvironment(null)
  core.configureNativeCore({ enabled: true })
  if (core.activeCore() !== 'native') fail('the downloaded native core did not load')
  if (!core.nativeTransport()) fail('the native core loaded without its transport')
  console.log(`native core ok on ${process.platform}-${process.arch} (first run: ${first})`)
})()
JS

# End to end through the CLI, now on the cached native core.
npx inup --native --json -d . > report.json
node -e "const r = require('./report.json'); if (!r.summary || r.summary.total < 1) process.exit(1); console.log('report', JSON.stringify(r.summary))"
