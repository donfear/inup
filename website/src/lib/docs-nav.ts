/**
 * The ordered docs navigation, shared by the sidebar and the prev/next
 * footer links. Collection entries plus the code-driven shortcuts page.
 */
import { getCollection } from 'astro:content';

export interface DocsNavItem {
  href: string;
  title: string;
  order: number;
}

export async function getDocsNav(base: string): Promise<DocsNavItem[]> {
  const entries = await getCollection('docs');
  return [
    ...entries.map((e) => ({
      href: `${base}/docs/${e.id}/`,
      title: e.data.title,
      order: e.data.order,
    })),
    // Rendered from README data, not markdown — lives outside the collection.
    { href: `${base}/docs/keyboard-shortcuts/`, title: 'Keyboard shortcuts', order: 30 },
  ].sort((a, b) => a.order - b.order);
}
