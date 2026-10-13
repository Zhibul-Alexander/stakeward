// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '@/App';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { LEARN_TABS } from '@/pages/LearnPage';
import { clusterHeadTags, ROBOTS_DISALLOW, robotsTxt, SITE_ORIGINS, SITEMAP_PATHS, sitemapXml } from '../seo.ts';

// robots.txt, sitemap.xml and the head tags of each build (seo.ts, DECISIONS D155). test/build-output.test.ts checks
// that the builds carry them.

function renderAt(path: string) {
  const { hook, searchHook } = memoryLocation({ path, static: true });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <App />
    </Router>,
  );
}

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

  it('devnet robots.txt has no sitemap and still lets crawlers read the noindex tag', () => {
    const lines = robotsTxt('devnet').split('\n');
    expect(lines.some((line) => line.startsWith('Sitemap:'))).toBe(false);
    expect(lines).not.toContain('Disallow: /');
    expect(clusterHeadTags('devnet')).toContainEqual({ name: 'robots', content: 'noindex' });
    expect(clusterHeadTags('mainnet').some((tag) => tag.name === 'robots')).toBe(false);
  });

  it('the preview image is an absolute address on each build’s own site', () => {
    expect(clusterHeadTags('mainnet')).toContainEqual({ property: 'og:image', content: 'https://stakeward.com/og-image.png' });
    expect(clusterHeadTags('devnet')).toContainEqual({ property: 'og:image', content: 'https://dev.stakeward.com/og-image.png' });
  });

  it('sitemap.xml lists every sitemap path as an absolute URL', () => {
    const xml = new DOMParser().parseFromString(sitemapXml(SITE_ORIGINS.mainnet), 'application/xml');
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    const locs = [...xml.getElementsByTagName('loc')].map((loc) => loc.textContent);
    expect(locs).toEqual(SITEMAP_PATHS.map((path) => `https://stakeward.com${path}`));
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
