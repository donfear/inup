import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const docs = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Sidebar position; keyboard-shortcuts (a code-driven page) slots in at 30. */
    order: z.number(),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { docs };
