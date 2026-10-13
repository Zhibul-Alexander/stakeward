import { useEffect } from 'react';
import { MAINNET_SITE_URL, TESTNET_SITE_URL, IS_DEVNET } from '@/config';
import { t, useLocale } from '@/i18n';
import { isIndexed, PAGES, type PageKey } from '@/page-meta';

const SITE_URL = IS_DEVNET ? TESTNET_SITE_URL : MAINNET_SITE_URL;

/** The `<meta>` or `<link>` of `selector` in the head, created when the page was not loaded from a built HTML file. */
function headElement<K extends 'meta' | 'link'>(tag: K, selector: string, attrs: Record<string, string>): HTMLElementTagNameMap[K] {
  const found = document.head.querySelector<HTMLElementTagNameMap[K]>(selector);
  if (found !== null) return found;
  const created = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) created.setAttribute(name, value);
  document.head.append(created);
  return created;
}

/**
 * The tab title, the description and the canonical link of one page (DECISIONS D156), in the current language. Search
 * engines that run JavaScript read them from here; the built HTML of each page in the sitemap carries the English ones
 * for those that do not (seo.ts). Renders nothing. A page that opens one account or one signing step has no canonical
 * link and shows the landing page's description.
 */
export function PageMeta({ page }: { page: PageKey }) {
  const locale = useLocale();

  useEffect(() => {
    document.title = t(`meta.${page}.title`);
    const description = isIndexed(page) ? t(`meta.${page}.description`) : t('meta.landing.description');
    headElement('meta', 'meta[name="description"]', { name: 'description' }).content = description;
    const canonical = document.head.querySelector('link[rel="canonical"]');
    const path = PAGES[page];
    if (path === null) canonical?.remove();
    else headElement('link', 'link[rel="canonical"]', { rel: 'canonical' }).href = `${SITE_URL}${path}`;
  }, [page, locale]);

  return null;
}
