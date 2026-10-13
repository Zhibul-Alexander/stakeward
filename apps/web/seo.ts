import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import en from './src/i18n/en.json';
import { PAGES, SITEMAP_PATHS, type PageKey } from './src/page-meta.ts';

/**
 * What search engines and link previews get (DECISIONS D155, D156). The site is one SPA per cluster, so robots.txt,
 * sitemap.xml and each page's head are written at build time from VITE_CLUSTER, like the rest of the build:
 * - mainnet (stakeward.com): robots.txt names the sitemap; the sitemap lists the pages worth finding.
 * - devnet (dev.stakeward.com): every page carries `noindex`, so the devnet copy never competes with the real site in
 *   search. Its robots.txt lets crawlers in on purpose: a crawler that may not fetch a page never sees its noindex.
 * - Each page of the sitemap gets an HTML file of its own (`learn/faq.html`, served at /learn/faq), the same as
 *   index.html but for the head: its title, description and canonical link from en.json. Link previews in Telegram
 *   and X read only that HTML. index.html carries the landing page's head and no canonical link, because the host
 *   serves it for every address without a file of its own; PageMeta sets those pages' tags once the app runs.
 */

export type SeoCluster = 'devnet' | 'mainnet';

/** Each build's own address; the same values as MAINNET_SITE_URL and TESTNET_SITE_URL in src/config.ts (seo.test.ts). */
export const SITE_ORIGINS: Record<SeoCluster, string> = {
  mainnet: 'https://stakeward.com',
  devnet: 'https://dev.stakeward.com',
};

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

/** Where index.html takes a page's head (title, description, preview tags, canonical link). */
export const PAGE_HEAD_PLACEHOLDER = '<!-- page head: seo.ts -->';

type PageText = { title: string; description: string };

/** The English title and description of a page with an address, from en.json (`meta.<page>`). */
export function pageText(page: PageKey): PageText {
  let node: unknown = en.meta;
  for (const part of page.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  const { title, description } = (node ?? {}) as Partial<PageText>;
  if (typeof title !== 'string' || typeof description !== 'string') throw new Error(`en.json has no meta.${page} title and description`);
  return { title, description };
}

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

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * The head of one page in one cluster's build. `canonical`: false for index.html, which the host also serves for
 * every address without a file of its own.
 */
export function pageHead(cluster: SeoCluster, page: PageKey, canonical: boolean): string {
  const { title, description } = pageText(page);
  const origin = SITE_ORIGINS[cluster];
  const path = PAGES[page];
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${origin}${OG_IMAGE_PATH}" />`,
  ];
  if (canonical && path !== null) lines.push(`<link rel="canonical" href="${origin}${path}" />`);
  if (cluster === 'devnet') lines.push('<meta name="robots" content="noindex" />');
  return lines.join('\n    ');
}

/** `html` (index.html) with the head of `page` in place of the placeholder. */
export function withPageHead(html: string, head: string): string {
  if (html.split(PAGE_HEAD_PLACEHOLDER).length !== 2) throw new Error(`index.html must hold ${PAGE_HEAD_PLACEHOLDER} once`);
  return html.replace(PAGE_HEAD_PLACEHOLDER, head);
}

/** The build file of each page in the sitemap but the landing page: `learn/faq.html` for /learn/faq. */
export function pageFiles(): { page: PageKey; fileName: string }[] {
  return (Object.entries(PAGES) as [PageKey, string | null][])
    .filter((entry): entry is [PageKey, string] => entry[1] !== null && entry[1] !== '/')
    .map(([page, path]) => ({ page, fileName: `${path.slice(1)}.html` }));
}

/**
 * Fills index.html with the landing page's head, and writes the other pages' HTML, robots.txt, sitemap.xml (mainnet
 * only) and the preview image into the build. `post`: index.html is final here, with its script and style tags.
 */
export function seoFiles(cluster: SeoCluster): Plugin {
  let template: string | undefined;
  return {
    name: 'stakeward-seo',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        template = html;
        return withPageHead(html, pageHead(cluster, 'landing', false));
      },
    },
    generateBundle() {
      if (template === undefined) throw new Error('stakeward-seo: index.html was not transformed before the bundle was written');
      for (const { page, fileName } of pageFiles()) {
        this.emitFile({ type: 'asset', fileName, source: withPageHead(template, pageHead(cluster, page, true)) });
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(cluster) });
      if (cluster === 'mainnet') {
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(SITE_ORIGINS[cluster]) });
      }
      this.emitFile({ type: 'asset', fileName: OG_IMAGE_PATH.slice(1), source: readFileSync(OG_IMAGE_SOURCE) });
    },
  };
}
