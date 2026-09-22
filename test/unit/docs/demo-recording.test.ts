import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercise the real Bash orchestration without a browser, registry, or encoder.
// The recorder is a POSIX script; the Windows CLI suite does not require Bash.
describe.skipIf(process.platform === 'win32')('demo recording output safety', () => {
  let scratch: string
  let repo: string
  let bin: string

  const gif = () => join(repo, 'docs/demo/interactive-upgrade.gif')
  const stub = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 })

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'inup-demo-test-'))
    repo = join(scratch, 'repo with spaces')
    bin = join(scratch, 'bin')
    mkdirSync(bin)
    mkdirSync(join(repo, 'docs/demo'), { recursive: true })
    mkdirSync(join(repo, 'docs/demo-project'))
    for (const file of ['record-demo.sh', 'demo-real.tape']) {
      copyFileSync(join(process.cwd(), 'docs/demo', file), join(repo, 'docs/demo', file))
    }
    writeFileSync(gif(), 'old gif')
    stub('pnpm', 'printf "%s\\n" "$*" >> "$TEST_DEMO_LOG"')
    stub('git', 'printf "test-commit\\n"')
    stub('rsync', 'exit 0')
    stub('node', 'printf "%s/config\\n" "$HOME"')
    stub(
      'vhs',
      `
if [ "$1" = --version ]; then echo 'vhs version 0.10.0'; exit 0; fi
test "$2" = -o
test ! -e "$3"
test -x "$VHS_DEMO_DIR/.bin/inup"
printf '%s\\n' "$3" > "$TEST_DEMO_OUTPUT"
printf '%s\\n' "$VHS_DEMO_DIR" > "$TEST_DEMO_WORKSPACE"
case "$TEST_DEMO_MODE" in
  missing) exit 0 ;;
  empty) touch "$3" ;;
  *) printf 'fresh recording' > "$3" ;;
esac`
    )
    stub(
      'ffprobe',
      `
case "$TEST_DEMO_MODE" in
  invalid) exit 1 ;;
  wrong-size) echo '1240x510' ;;
  *) echo '2480x1020' ;;
esac`
    )
    stub(
      'ffmpeg',
      `
output="\${!#}"
case "$TEST_DEMO_MODE:$output" in
  palette-failure:*/palette.png|gif-failure:*/interactive-upgrade-1240.gif) exit 1 ;;
esac
printf 'fresh conversion' > "$output"`
    )
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  function record(mode: string) {
    return spawnSync('bash', [join(repo, 'docs/demo/record-demo.sh')], {
      cwd: scratch,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: scratch,
        TEST_DEMO_MODE: mode,
        TEST_DEMO_LOG: join(scratch, 'commands'),
        TEST_DEMO_OUTPUT: join(scratch, 'output-path'),
        TEST_DEMO_WORKSPACE: join(scratch, 'workspace-path'),
        DEMO_WORKSPACE_ROOT: join(scratch, 'workspace'),
      },
    })
  }

  it.each(['missing', 'empty', 'invalid', 'wrong-size', 'palette-failure', 'gif-failure'])(
    'fails without replacing the tracked GIF when recording is %s',
    (mode) => {
      const result = record(mode)
      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(readFileSync(gif(), 'utf8')).toBe('old gif')
      const output = readFileSync(join(scratch, 'output-path'), 'utf8').trim()
      expect(existsSync(dirname(output))).toBe(false)
      expect(existsSync(join(scratch, 'workspace', 'my-app'))).toBe(false)
      if (mode === 'missing' || mode === 'empty') {
        expect(result.stderr).toContain('VHS did not create a fresh GIF')
      }
    }
  )

  it('builds the checkout and publishes the GIF only after fresh output and a successful conversion', () => {
    const result = record('success')
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Recording source: test-commit')
    expect(readFileSync(join(scratch, 'commands'), 'utf8')).toBe(
      'build\ninstall --prefer-offline\n'
    )
    expect(readFileSync(gif(), 'utf8')).toBe('fresh conversion')
    const output = readFileSync(join(scratch, 'output-path'), 'utf8').trim()
    expect(output).not.toContain(repo)
    expect(existsSync(dirname(output))).toBe(false)
    // inup prints resolved project paths in its upgrade report, and the report
    // is on screen at the end of the demo. The recorded project therefore lives
    // at a plain <root>/my-app, never inside the per-run mktemp scratch.
    const workspace = readFileSync(join(scratch, 'workspace-path'), 'utf8').trim()
    expect(workspace).toBe(join(scratch, 'workspace', 'my-app'))
    expect(existsSync(workspace)).toBe(false)
  })
})
