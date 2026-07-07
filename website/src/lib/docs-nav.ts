/**
 * The ordered docs navigation, shared by the sidebar, the prev/next
 * footer links, the docs landing page and llms.txt. Collection entries
 * plus the code-driven pages listed in `extraDocs` — one list, so a
 * retitle or reorder can never leave a consumer stale.
 */
import { getCollection } from 'astro:content';
import { base } from './url';

export interface DocsNavItem {
  href: string;
  title: string;
  description: string;
  order: number;
}

/** Docs pages rendered from code (README data), not markdown. */
export const extraDocs: DocsNavItem[] = [
  {
    href: `${base}/docs/keyboard-shortcuts/`,
    title: 'Keyboard shortcuts',
    description:
      "Every key binding in inup's interactive picker — always current, generated from the same source as the tool's help screen.",
    order: 30,
  },
];

export async function getDocsNav(): Promise<DocsNavItem[]> {
  const entries = await getCollection('docs');
  const collected = entries.map((e) => ({
    href: `${base}/docs/${e.id}/`,
    title: e.data.title,
    description: e.data.description,
    order: e.data.order,
  }));

  for (const extra of extraDocs) {
    if (collected.some((e) => e.order === extra.order)) {
      throw new Error(
        `docs-nav: order ${extra.order} is reserved for "${extra.title}" — renumber the markdown doc`,
      );
    }
  }

  return [{ href: `${base}/docs/`, title: 'Overview', description: '', order: 0 }]
    .concat(collected, extraDocs)
    .sort((a, b) => a.order - b.order);
}
