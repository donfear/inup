#!/usr/bin/env node
// Stamps CHANGELOG.md for a release: renames [Unreleased] to the new version
// with today's date, opens a fresh empty [Unreleased] above it, and updates
// the link definitions at the bottom.
//
//   node scripts/release-changelog.mjs <new-version> <previous-tag>
//   node scripts/release-changelog.mjs 1.8.0 v1.7.0
//
// If [Unreleased] has no entries, the file is left untouched — a release with
// nothing user-facing gets no section, which is the documented convention
// (docs/releasing.md). The writing stays manual; only the stamping is not.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, previousTag] = process.argv.slice(2);
if (!version || !previousTag) {
  console.error('Usage: node scripts/release-changelog.mjs <new-version> <previous-tag>');
  process.exit(1);
}

const path = join(process.cwd(), 'CHANGELOG.md');
const changelog = readFileSync(path, 'utf8');

const heading = /^## \[Unreleased\]\n/m;
const match = heading.exec(changelog);
if (!match) {
  console.error('CHANGELOG.md has no "## [Unreleased]" heading.');
  process.exit(1);
}

const bodyStart = match.index + match[0].length;
const next = changelog.slice(bodyStart).search(/^## \[/m);
const bodyEnd = next === -1 ? changelog.length : bodyStart + next;
const body = changelog.slice(bodyStart, bodyEnd);

if (!/^- /m.test(body)) {
  console.log(
    `CHANGELOG.md [Unreleased] is empty — leaving it untouched, so v${version} gets no section.`,
  );
  process.exit(0);
}

const date = process.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10);

// Rename [Unreleased] to the version, and open a fresh empty one above it.
const stamped =
  changelog.slice(0, match.index) +
  `## [Unreleased]\n\n## [${version}] - ${date}\n` +
  changelog.slice(bodyStart);

// Repoint the [Unreleased] link definition and add one for this version.
const unreleasedRef = /^\[Unreleased\]: (\S+)\/compare\/\S+\.\.\.HEAD$/m;
const refMatch = unreleasedRef.exec(stamped);
if (!refMatch) {
  console.error('CHANGELOG.md has no "[Unreleased]: …/compare/…...HEAD" link definition.');
  process.exit(1);
}

const repoUrl = refMatch[1];
const updated = stamped.replace(
  unreleasedRef,
  `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD\n` +
    `[${version}]: ${repoUrl}/compare/${previousTag}...v${version}`,
);

writeFileSync(path, updated);
console.log(`CHANGELOG.md stamped: [Unreleased] -> [${version}] - ${date}.`);
