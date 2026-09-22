/**
 * llms.txt — a machine-readable index of the site for AI agents
 * (https://llmstxt.org). Fitting for a tool whose --json mode is
 * built for scripts and agents. Full docs bodies: /llms-full.txt.
 */
import type { APIContext } from 'astro';
import { getDocsNav } from '../lib/docs-nav';
import { absUrl } from '../lib/url';
import { site } from '../data/site';

export async function GET(context: APIContext) {
  const url = (path: string) => absUrl(path, context.site!);

  // Same source as the sidebar — a retitled or reordered doc can never
  // leave this index stale. Overview (order 0) is the HTML landing page.
  const docLinks = (await getDocsNav())
    .filter((item) => item.order > 0)
    .map(
      (item) => `- [${item.title}](${new URL(item.href, context.site!).href}): ${item.description}`,
    )
    .join('\n');

  const body = `# inup

> ${site.description}

inup runs headless when stdout is not a TTY or $CI is set. \`inup --json\`
emits a machine-readable report with a schemaVersion; \`inup --check\` is a
read-only CI gate; \`inup --apply\` writes safe upgrades. Node ${site.nodeRequirement}.

## Docs

${docLinks}

## Reference

- [Full documentation as plain text](${url('/llms-full.txt')})
- [Changelog](${url('/changelog/')}): Every release with notes.
- [Releases RSS](${url('/rss.xml')})
- [GitHub](${site.repoUrl})
- [npm](${site.npmUrl})
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
