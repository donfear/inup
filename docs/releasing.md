# Releasing & writing the changelog

How a release is cut, and — the part that needs judgment — how
[`CHANGELOG.md`](../CHANGELOG.md) gets written. The changelog is maintained
by hand. There is deliberately no generator: auto-generated notes restate
PR titles, and a PR title is written for a reviewer, not for someone
deciding whether to upgrade.

## The contract

`CHANGELOG.md` is written **for a person using the `inup` CLI**, deciding
whether this release affects them. It is not a mirror of the commit log —
GitHub already has that.

The test for every line: *would someone who runs `inup` notice this, or
change what they do because of it?* If no, it does not belong in the file.

| Belongs | Does not belong |
|---|---|
| New flags, config keys, keybindings | Refactors, file moves, architecture changes |
| Changed defaults or output | Test additions, coverage work |
| Bugs a user could actually hit | CI, workflows, release plumbing |
| Performance a user can feel | Dependency bumps with no behavior change |
| Anything that breaks existing usage | Formatting, linting, docs-internal edits |
| Security fixes, always | |

A release where nothing passes that test gets **no section at all**. It
still ships to npm and still has a git tag — it just has nothing to say
here. Several versions in this project's history are like that; the gaps in
the version list are intentional, not missing entries.

## Gathering the material

Before writing, look at what actually merged since the last tag:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline   # what merged
git show <sha> -- src/                                       # what it actually did
git show <sha> -- README.md                                  # what it claimed it did
```

**The source is the authority, not the README.** The README diff is a
useful index — it usually names the new flag or config key exactly — but it
has been wrong here before. When this changelog was backfilled, v1.1.0's
README documented a `--minor` flag that was never implemented; a whole
entry was written for a feature that did not exist, and nearly shipped.
Before you name a flag, confirm it:

```bash
git grep -n -- "--the-flag" <tag> -- src/
```

Commit subjects are no better. Squash merges in this repo are often raw
branch names (`feat/hill-climb-concurrency`, `chore/deps-up`), and one
release's commit message announced a flag that a later commit in the same
PR removed. They tell you where to look; they are not entries.

**PR links predate the rename.** Anything before v1.4.0 belongs to the
archived `donfear/pnpm-upgrade-interactive` repo — numbering restarted at
`#1` in `donfear/inup`, so an old PR number linked to the new repo silently
points at an unrelated pull request.

## Writing entries

**Categories.** Keep a Changelog's six, and only the ones with content:

- **Added** — new capability that did not exist.
- **Changed** — existing behavior now works differently, including
  performance a user can feel.
- **Deprecated** — still works, scheduled to go. Say what replaces it.
- **Removed** — gone. If it breaks existing usage, say what to do instead.
- **Fixed** — a bug someone could hit. Describe the *symptom*, not the
  patch.
- **Security** — vulnerability fixes. Never fold these into Fixed.

**Voice.** Effect first, mechanism only if it explains the effect. One line
per user-visible change — merge the five commits that built one feature
into one bullet, and split one commit that shipped two unrelated things
into two.

| Instead of | Write |
|---|---|
| `refactor: memoize dependency graph traversal` | Faster startup on large lockfiles |
| `feat/npmrc-registry-auth (#74)` | Read auth tokens from `.npmrc`, so private registries work without extra configuration |
| Fixed a bug in version comparison | Prerelease versions (`-rc.1`, `-beta`) are no longer offered as stable upgrades |
| Various improvements | *(nothing — name them, or drop them)* |

**Specifics.** Name the flag, the config key, the file, the key binding.
Backtick them. A reader scanning for `--json` should find it.

**Links.** Append the PR when it adds context a reader might want to chase:
`([#123](https://github.com/donfear/inup/pull/123))`. Skip it for trivia.

**Accuracy over polish.** If a diff is unclear, write the vaguer line that
is definitely true rather than the specific one you're guessing at. A
changelog that is wrong once stops being trusted.

**Headline releases get one italic line** between the heading and the first
category, saying what the release is *for* — the thing a reader would tell
a colleague. `*inup becomes a program, not just a terminal UI.*` Earn it:
roughly one release in four has one, and a patch release that fixes two
bugs does not. It frames the bullets; it never replaces them.

**Say what the bug did, not just that it existed.** "Fixed a Windows path
bug" tells no one whether they were affected. "Every upgrade rewrote the
whole file to LF, turning a one-line change into a full-file diff" tells
them immediately. The symptom is the useful half.

## Cutting a release

1. Finish the `[Unreleased]` section — everything merged since the last tag
   that passes the contract above — and merge it. Do this *before*
   triggering the release, not after. **This is the only manual step**, and
   nothing downstream will do it for you.
2. Run the **Release** workflow (`.github/workflows/release.yml`) with the
   right bump type. It bumps `package.json`, then runs
   `scripts/release-changelog.mjs`, which renames `[Unreleased]` to
   `## [x.y.z] - YYYY-MM-DD`, opens a fresh empty `[Unreleased]` above it,
   and rewrites the link definitions at the bottom:

   ```
   [Unreleased]: https://github.com/donfear/inup/compare/v1.8.0...HEAD
   [1.8.0]: https://github.com/donfear/inup/compare/v1.7.0...v1.8.0
   ```

   The version's URL compares against the **previous git tag**, which is
   not always the previous section in this file — releases with nothing
   user-facing are skipped here but still exist as tags, so the script
   takes the tag from `git describe` rather than reading the file.

   Both changes are committed alongside the version bump, then tagged, the
   floating `v1` tag is moved, and `publish.yml` pushes to npm.

   If `[Unreleased]` is empty the script leaves the file alone and that
   version gets no section — the documented behavior for an internal-only
   release. It is not a safety net: if you forget to write the entries,
   the release ships silently undocumented. The PR checklist is where that
   gets caught.
3. The workflow creates the GitHub Release with auto-generated notes. If
   you want the release page to match this file — worth it for anything
   bigger than a patch — paste the section over them:

   ```bash
   V=1.8.0
   awk -v tag="## [$V]" 'index($0,tag)==1 {f=1; next} /^## \[/ {f=0} f' CHANGELOG.md \
     | gh release edit "v$V" --notes-file -
   ```

   That prints the section's body without its heading — the release page
   already shows the version as its title.

## Native core packages

Every release also publishes inup's native core for 8 platforms. `publish.yml` does all of it; there is nothing to do by hand once the packages exist.

1. **Build.** `native-build.yml` builds the addon for each platform and smoke-tests it on that platform: real arm64 runners, x64 under Rosetta, and Alpine containers for musl. It also checks that Linux builds need at most glibc 2.28.
2. **Platform packages.** `scripts/publish-native.mjs` publishes one package per platform at inup's version.
   - The packages are `inup-darwin-arm64`, `inup-darwin-x64`, `inup-linux-{x64,arm64}-{gnu,musl}`, `inup-windows-x64` and `inup-windows-arm64`. npm's spam detection rejects `inup-win32-*` names.
   - It refuses to publish anything if any platform's addon is missing.
   - It skips versions already on npm, so a failed publish job can be **re-run** safely.
3. **inup.** Published only after the platform packages. `inup` does not depend on them: `inup --native` downloads the one it needs.
4. **Verify.** `verify-published.yml` installs the published version with npm, pnpm and bun on Linux, macOS, Windows and Alpine (x64 and arm64). On each it requires the first `--native` run to download the core and the next to use it. You can also run it by hand from the Actions tab for any version.

**Release candidates.** Anything that changes `native/` ships as an RC first:

```bash
pnpm version 1.8.0-rc.0 --no-git-tag-version
git commit -am "release: v1.8.0-rc.0"
git tag v1.8.0-rc.0
git push origin HEAD v1.8.0-rc.0
```

A version with a `-` publishes under the `next` dist-tag, so users on `latest` are unaffected. RC tags don't move the floating `v1` tag and are ignored as changelog baselines. Try it with `npx inup@next --native` (twice). When it's good, run the Release workflow as usual: `minor` or `patch` from `1.8.0-rc.N` both give `1.8.0`.

**If a stable release is broken,** point `latest` back while you fix it: `npm dist-tag add inup@<previous> latest`. The native core is opt-in and falls back to TypeScript whenever it can't be used, so native problems cost speed, not correctness.

**Trusted publishing** is configured on npmjs.com for `inup` and all 8 platform packages: repository `donfear/inup`, workflow `publish.yml`, no environment, "Allow npm publish" ticked. A new platform package needs a one-time `0.0.0` placeholder publish before that setting exists.

## Drafting with an LLM

Hand a model the commit range *and the diffs*, not just the subjects, and
give it the contract. A prompt that works:

> You are writing `CHANGELOG.md` entries for `inup`, an interactive CLI
> dependency upgrader. Below is every commit merged since the last release,
> with diffs.
>
> Write the `[Unreleased]` section as a maintainer would. Rules:
> - Write for someone using the CLI deciding whether to upgrade — describe
>   the effect, not the implementation. One line per user-visible change.
> - Omit anything a user would not notice: refactors, tests, CI, build
>   tooling, dependency bumps with no behavior change, formatting.
> - Group under `### Added`, `### Changed`, `### Deprecated`, `### Removed`,
>   `### Fixed`, `### Security` — only the headers that have entries.
> - Name exact flags, config keys and files in backticks. Get them from the
>   README and source diffs, not from the branch name.
> - Append the PR link as `([#N](https://github.com/donfear/inup/pull/N))`.
> - If a change's effect is unclear from the diff, say so instead of
>   inventing specifics.
>
> Output only the markdown section. No preamble.

Then **check every line against the diff before committing it.** A model
will happily invent a flag name that reads plausibly. The rule from the
[roadmap](roadmap/README.md) applies here too: every claim is verifiable, or
it doesn't ship.
