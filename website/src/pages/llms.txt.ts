/**
 * llms.txt — a machine-readable index of the site for AI agents
 * (https://llmstxt.org). Fitting for a tool whose --json mode is
 * built for scripts and agents. Full docs bodies: /llms-full.txt.
 */
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../data/site';

export async function GET(context: APIContext) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = (path: string) => new URL(`${base}${path}`, context.site!).href;

  const docs = (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
  const docLinks = docs
    .map((d) => `- [${d.data.title}](${url(`/docs/${d.id}/`)}): ${d.data.description}`)
    .join('\n');

  const body = `# inup

> ${site.description}

inup runs headless when stdout is not a TTY or $CI is set. \`inup --json\`
emits a machine-readable report with a schemaVersion; \`inup --check\` is a
read-only CI gate; \`inup --apply\` writes safe upgrades. Node ${site.nodeRequirement}.

## Docs

${docLinks}
- [Keyboard shortcuts](${url('/docs/keyboard-shortcuts/')}): Every key binding in the interactive picker.

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
