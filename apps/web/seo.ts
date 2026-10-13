import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * What search engines and link previews get (DECISIONS D155). The site is one SPA per cluster, so robots.txt,
 * sitemap.xml and the cluster's head tags are written at build time from VITE_CLUSTER, like the rest of the build:
 * - mainnet (stakeward.com): robots.txt names the sitemap; the sitemap lists the pages worth finding.
 * - devnet (dev.stakeward.com): every page carries `noindex`, so the devnet copy never competes with the real site in
 *   search. Its robots.txt lets crawlers in on purpose: a crawler that may not fetch a page never sees its noindex.
 */

export type SeoCluster = 'devnet' | 'mainnet';

/** Each build's own address; the same values as MAINNET_SITE_URL and TESTNET_SITE_URL in src/config.ts (seo.test.ts). */
export const SITE_ORIGINS: Record<SeoCluster, string> = {
  mainnet: 'https://stakeward.com',
  devnet: 'https://dev.stakeward.com',
};

/**
 * Pages in the sitemap: the ones that make sense to land on from a search. Not the per-account pages (/withdraw/:account
 * and the like), /cosign (its transaction lives in the URL fragment) or the devnet-only /dev pages.
 * Every path must open a real page (test/seo.test.tsx renders each one).
 */
export const SITEMAP_PATHS = [
  '/',
  '/learn/faq',
  '/learn/alerts',
  '/learn/costs',
  '/learn/wallets',
  '/learn/safety',
  '/app',
  '/check',
  '/protect',
  '/rescue',
  '/rescue-kit',
  '/stake',
  '/demo',
  '/stats',
  '/challenge',
] as const;

/**
 * Kept out of crawling on both clusters. /api/: a crawler rendering a page would spend the RPC quota and the per-IP
 * limits that real visitors need. The rest open one wallet or account, or a signing step, and say nothing to a search.
 * /proof/:wallet stays crawlable: it is made to be shared (D124).
 */
export const ROBOTS_DISALLOW = [
  '/api/',
  '/app?',
  '/cosign',
  '/withdraw/',
  '/extend/',
  '/change-key/',
  '/delegate/',
  '/try-steal/',
  '/recovery/',
  '/rescue-kit/',
] as const;

/** The preview image for link cards (Telegram, X, Slack): the Stakeward mark, from its one source in docs/brand. */
export const OG_IMAGE_PATH = '/og-image.png';
const OG_IMAGE_SOURCE = new URL('../../docs/brand/logo-512.png', import.meta.url);

export function robotsTxt(cluster: SeoCluster): string {
  const origin = SITE_ORIGINS[cluster];
  const lines =
    cluster === 'mainnet'
      ? [`# ${origin}`]
      : [`# ${origin} is the devnet copy of Stakeward. Its pages carry noindex; the site is ${SITE_ORIGINS.mainnet}.`];
  lines.push('User-agent: *', ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`));
  if (cluster === 'mainnet') lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function sitemapXml(origin: string): string {
  const urls = SITEMAP_PATHS.map((path) => `  <url><loc>${origin}${path}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** Head tags that depend on the cluster; the rest of the head is static in index.html. */
export function clusterHeadTags(cluster: SeoCluster): { name?: string; property?: string; content: string }[] {
  const tags: { name?: string; property?: string; content: string }[] = [
    { property: 'og:image', content: `${SITE_ORIGINS[cluster]}${OG_IMAGE_PATH}` },
  ];
  if (cluster === 'devnet') tags.push({ name: 'robots', content: 'noindex' });
  return tags;
}

/** Writes robots.txt, sitemap.xml (mainnet only) and the preview image into the build, and the cluster's head tags. */
export function seoFiles(cluster: SeoCluster): Plugin {
  return {
    name: 'stakeward-seo',
    transformIndexHtml() {
      return clusterHeadTags(cluster).map((attrs) => ({ tag: 'meta', attrs, injectTo: 'head' as const }));
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(cluster) });
      if (cluster === 'mainnet') {
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(SITE_ORIGINS[cluster]) });
      }
      this.emitFile({ type: 'asset', fileName: OG_IMAGE_PATH.slice(1), source: readFileSync(OG_IMAGE_SOURCE) });
    },
  };
}
