/**
 * URL helpers shared by every page and endpoint. `import.meta.env.BASE_URL`
 * is statically replaced by Vite, so this module works in any context.
 */

/** The GitHub Pages base path without a trailing slash (e.g. "/inup"). */
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Absolute site URL for a base-relative path (leading slash required). */
export function absUrl(path: string, site: URL | string): string {
  return new URL(`${base}${path}`, site).href;
}
