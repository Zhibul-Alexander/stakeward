/**
 * Every page with a tab title of its own (DECISIONS D156). Each key names `meta.<key>.title` in the catalogs; the value
 * is the page's address in sitemap.xml and in its canonical link, or null for a page that opens one account, one
 * wallet or one signing step (robots.txt keeps crawlers out of most of them). A page with an address also has
 * `meta.<key>.description`; the others show the landing page's description.
 *
 * No imports: seo.ts reads this file at build time, outside the app, to write sitemap.xml and one HTML file per page
 * with its own head (link previews in Telegram and X do not run JavaScript).
 */
export const PAGES = {
  landing: '/',
  'learn.faq': '/learn/faq',
  'learn.alerts': '/learn/alerts',
  'learn.costs': '/learn/costs',
  'learn.wallets': '/learn/wallets',
  'learn.safety': '/learn/safety',
  app: '/app',
  check: '/check',
  protect: '/protect',
  rescue: '/rescue',
  rescueKit: '/rescue-kit',
  stake: '/stake',
  demo: '/demo',
  stats: '/stats',
  challenge: '/challenge',
  withdraw: null,
  extend: null,
  changeKey: null,
  delegate: null,
  rescueNow: null,
  cosign: null,
  trySteal: null,
  recovery: null,
  proof: null,
  notFound: null,
} as const satisfies Record<string, string | null>;

export type PageKey = keyof typeof PAGES;

/** The pages with an address: in sitemap.xml, with a canonical link and a description of their own. */
export type IndexedPage = { [K in PageKey]: (typeof PAGES)[K] extends string ? K : never }[PageKey];

export function isIndexed(page: PageKey): page is IndexedPage {
  return PAGES[page] !== null;
}

/** The addresses in sitemap.xml, in the order above. */
export const SITEMAP_PATHS: readonly string[] = Object.values(PAGES).filter((path) => path !== null);
