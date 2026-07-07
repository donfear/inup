/**
 * One markdown pipeline for GitHub release notes (changelog page + RSS).
 *
 * Raw HTML is dropped: GitHub auto-generates release notes from PR
 * titles, which contributors control — markup must never flow from a
 * PR title into our pages or feed.
 */
import { Marked } from 'marked';

const marked = new Marked({
  renderer: {
    html: () => '',
  },
});

/**
 * GitHub release bodies reference PRs, users and compare views by bare
 * URL; compact them into readable links before rendering.
 */
function compactGitHubLinks(md: string): string {
  return md
    .replace(
      /by @([\w-]+) in (https:\/\/github\.com\/[\w./-]+\/pull\/(\d+))/g,
      'by [@$1](https://github.com/$1) in [#$3]($2)',
    )
    .replace(/(?<!\()\bhttps:\/\/github\.com\/[\w./-]+\/pull\/(\d+)\b(?!\))/g, '[#$1]($&)')
    .replace(
      /\*\*Full Changelog\*\*: (https:\/\/github\.com\/[\w./-]+\/compare\/([\w./-]+))/g,
      '**Full changelog**: [`$2`]($1)',
    );
}

export async function renderReleaseNotes(body: string): Promise<string> {
  return String(await marked.parse(compactGitHubLinks(body)));
}
