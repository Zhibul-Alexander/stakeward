// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '@/App';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { loadLocale } from '@/i18n';
import ka from '@/i18n/ka.json';
import { LEARN_TABS } from '@/pages/LearnPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PAGES, SITEMAP_PATHS } from '@/page-meta';
import { pageFiles, pageHead, pageText, ROBOTS_DISALLOW, robotsTxt, SITE_ORIGINS, sitemapXml } from '../seo.ts';

// robots.txt, sitemap.xml, each page's head in the build (seo.ts) and in the running app (PageMeta), DECISIONS D155 and
// D156. test/build-output.test.ts checks that the builds carry them. Tests run as the devnet build.

const STAKE = 'Stake11111111111111111111111111111111111111';
const LANDING_DESCRIPTION = 'Lock your natively staked SOL with a second key you control, so a stolen wallet key cannot withdraw it.';

function renderAt(path: string) {
  const location = memoryLocation({ path });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <App />
    </Router>,
  );
  return location;
}

const description = () => document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content;
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;

describe('seo files', () => {
  it('use the same site addresses as the app', () => {
    expect(SITE_ORIGINS.mainnet).toBe(MAINNET_SITE_URL);
    expect(SITE_ORIGINS.devnet).toBe(TESTNET_SITE_URL);
  });

  it('mainnet robots.txt names the sitemap and blocks only the API and per-account pages', () => {
    const text = robotsTxt('mainnet');
    const lines = text.split('\n');
    expect(lines).toContain('User-agent: *');
    expect(lines).toContain('Sitemap: https://stakeward.com/sitemap.xml');
    expect(lines.filter((line) => line.startsWith('Disallow:'))).toEqual(ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`));
    expect(lines).not.toContain('Disallow: /');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('devnet robots.txt has no sitemap and still lets crawlers read the noindex tag of every page', () => {
    const lines = robotsTxt('devnet').split('\n');
    expect(lines.some((line) => line.startsWith('Sitemap:'))).toBe(false);
    expect(lines).not.toContain('Disallow: /');
    expect(pageHead('devnet', 'landing', false)).toContain('<meta name="robots" content="noindex" />');
    expect(pageHead('devnet', 'learn.faq', true)).toContain('<meta name="robots" content="noindex" />');
    expect(pageHead('mainnet', 'landing', false)).not.toContain('noindex');
  });

  it('sitemap.xml lists every page with an address, as an absolute URL', () => {
    const xml = new DOMParser().parseFromString(sitemapXml(SITE_ORIGINS.mainnet), 'application/xml');
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    const locs = [...xml.getElementsByTagName('loc')].map((loc) => loc.textContent);
    expect(locs).toEqual(SITEMAP_PATHS.map((path) => `https://stakeward.com${path}`));
    expect(SITEMAP_PATHS[0]).toBe('/');
  });

  it('robots.txt does not block a page the sitemap lists', () => {
    for (const path of SITEMAP_PATHS) {
      expect(ROBOTS_DISALLOW.filter((blocked) => path.startsWith(blocked)), path).toEqual([]);
    }
  });

  it('lists every Learn tab', () => {
    for (const tab of LEARN_TABS) expect(SITEMAP_PATHS).toContain(`/learn/${tab}`);
  });

  it.each(SITEMAP_PATHS)('%s opens a page, not the not-found page', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Page not found' })).not.toBeInTheDocument();
  });
});

describe('the head of each page in the build', () => {
  it('writes one HTML file per sitemap page but the landing page, at the path the host serves it from', () => {
    expect(pageFiles().map(({ fileName }) => `/${fileName.replace(/\.html$/, '')}`)).toEqual(SITEMAP_PATHS.slice(1));
  });

  it('takes the English title and description of the page, and its canonical address', () => {
    const head = pageHead('mainnet', 'learn.faq', true);
    expect(head).toContain('<title>Questions and answers · Stakeward</title>');
    expect(head).toContain(`<meta name="description" content="${pageText('learn.faq').description}" />`);
    expect(head).toContain('<meta property="og:title" content="Questions and answers · Stakeward" />');
    expect(head).toContain('<meta property="og:image" content="https://stakeward.com/og-image.png" />');
    expect(head).toContain('<link rel="canonical" href="https://stakeward.com/learn/faq" />');
    expect(pageHead('devnet', 'learn.faq', true)).toContain('<meta property="og:image" content="https://dev.stakeward.com/og-image.png" />');
  });

  it('gives index.html no canonical link: the host serves it for every address without a file of its own', () => {
    expect(pageHead('mainnet', 'landing', false)).not.toContain('canonical');
    expect(pageHead('mainnet', 'landing', false)).toContain(`<meta name="description" content="${LANDING_DESCRIPTION}" />`);
  });

  it('has a title and description in en.json for every page with an address', () => {
    for (const [page, path] of Object.entries(PAGES)) {
      if (path === null) continue;
      expect(() => pageText(page as keyof typeof PAGES), page).not.toThrow();
    }
  });
});

describe('PageMeta', () => {
  afterEach(async () => {
    await loadLocale('en');
  });

  it.each([
    ['/', 'landing', 'Stakeward: lock your staked SOL with a second key'],
    ['/learn/costs', 'learn.costs', 'What it costs · Stakeward'],
    // No tab, or an unknown one, shows the FAQ: one canonical address for all of them.
    ['/learn', 'learn.faq', 'Questions and answers · Stakeward'],
    ['/learn/nope', 'learn.faq', 'Questions and answers · Stakeward'],
    ['/app', 'app', 'Your stake accounts · Stakeward'],
    ['/protect', 'protect', 'Protect your stake · Stakeward'],
  ] as const)('%s: its title, description and canonical link', (path, page, title) => {
    renderAt(path);
    expect(document.title).toBe(title);
    expect(description()).toBe(pageText(page).description);
    expect(canonical()).toBe(`https://dev.stakeward.com${PAGES[page]}`);
  });

  it.each([
    [`/withdraw/${STAKE}`, 'Withdraw · Stakeward'],
    [`/try-steal/${STAKE}`, 'Try to steal this stake · Stakeward'],
    ['/cosign', 'Co-sign a transaction · Stakeward'],
    ['/no-such-page', 'Page not found · Stakeward'],
  ])('%s: its title, the landing description and no canonical link', (path, title) => {
    renderAt(path);
    expect(document.title).toBe(title);
    expect(description()).toBe(LANDING_DESCRIPTION);
    expect(canonical()).toBeNull();
  });

  it('follows the app from page to page', () => {
    const location = renderAt('/stats');
    expect(canonical()).toBe('https://dev.stakeward.com/stats');
    act(() => {
      location.navigate(`/extend/${STAKE}`);
    });
    expect(document.title).toBe('Extend the lock · Stakeward');
    expect(canonical()).toBeNull();
  });

  it('writes in the language the viewer picked', async () => {
    await loadLocale('ka');
    renderAt('/rescue');
    expect(document.title).toBe(ka.meta.rescue.title);
    expect(description()).toBe(ka.meta.rescue.description);
  });

  it('lets the recovery card name its account in the tab title after it', () => {
    renderAt(`/recovery/${STAKE}`);
    expect(document.title).toMatch(/^Stakeward recovery card \S+/);
  });
});

describe('not-found page', () => {
  it('is kept out of search while it is shown', () => {
    const noindex = () => document.head.querySelectorAll('meta[name="robots"][content="noindex"]').length;
    const view = render(
      <Router hook={memoryLocation({ path: '/no-such-page', static: true }).hook}>
        <NotFoundPage />
      </Router>,
    );
    expect(noindex()).toBe(1);
    view.unmount();
    expect(noindex()).toBe(0);
  });
});
