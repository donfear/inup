/**
 * llms-full.txt — the complete docs as one plain-text document for AI
 * agents (https://llmstxt.org), generated from the same markdown that
 * renders /docs plus the README-derived keyboard shortcuts.
 */
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { keys } from '../lib/readme';
import { site } from '../data/site';

export async function GET(_context: APIContext) {
  const docs = (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);

  const shortcuts = ['| Key | Action |', '| --- | --- |']
    .concat(keys.map((k) => `| ${k.keys} | ${k.action} |`))
    .join('\n');

  const sections = docs
    .map((d) => `## ${d.data.title}\n\n${d.body?.trim() ?? ''}`)
    .join('\n\n---\n\n');

  const body = `# inup — full documentation

> ${site.description}

${sections}

---

## Keyboard shortcuts

${shortcuts}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
