/**
 * Build-time live data: npm version + downloads, GitHub stars + releases.
 * Every fetch degrades gracefully — the build must never fail on network.
 * Fetches run once per build (module-level top-level await). In dev they
 * are skipped unless FETCH_STATS=1, to stay clear of API rate limits.
 */
import { site } from '../data/site';

export interface Release {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  url: string;
  prerelease: boolean;
}

export interface SiteStats {
  version: string;
  monthlyDownloads: number | null;
  stars: number | null;
  releases: Release[];
}

const skip = import.meta.env.DEV && !process.env.FETCH_STATS;

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  if (skip) return null;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[stats] ${url} failed (${err}); using fallback`);
    return null;
  }
}

const githubHeaders: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'inup-website-build',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

const [registry, downloads, repo, releases] = await Promise.all([
  fetchJson<{ version: string }>('https://registry.npmjs.org/inup/latest'),
  fetchJson<{ downloads: number }>('https://api.npmjs.org/downloads/point/last-month/inup'),
  fetchJson<{ stargazers_count: number }>('https://api.github.com/repos/donfear/inup', githubHeaders),
  fetchJson<
    Array<{
      tag_name: string;
      name: string | null;
      published_at: string;
      body: string | null;
      html_url: string;
      prerelease: boolean;
      draft: boolean;
    }>
  >('https://api.github.com/repos/donfear/inup/releases?per_page=50', githubHeaders),
]);

export const stats: SiteStats = {
  version: registry?.version ?? site.lastKnownVersion,
  monthlyDownloads: downloads?.downloads ?? null,
  stars: repo?.stargazers_count ?? null,
  releases: (releases ?? [])
    // Only real semver releases; the floating `v1` action tag is not a release note.
    .filter((r) => !r.draft && /^v\d+\.\d+\.\d+/.test(r.tag_name))
    .map((r) => ({
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      publishedAt: r.published_at,
      body: r.body ?? '',
      url: r.html_url,
      prerelease: r.prerelease,
    })),
};
