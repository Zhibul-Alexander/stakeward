import { expect, test } from './fixtures.ts';
import { mockApi, SMOKE_FIXTURE } from './mock-api.ts';

/**
 * Search and link previews on the built devnet site (D155, D156). `vite preview` serves `learn/faq.html` at /learn/faq,
 * as Cloudflare does, so a page's own head is there before any JavaScript runs; the app then keeps the head in step as
 * the visitor moves between pages.
 */
test('each page answers with its own head, and the app keeps it in step', async ({ page, request }) => {
  const faq = await request.get('/learn/faq');
  expect(faq.status()).toBe(200);
  const html = await faq.text();
  expect(html).toContain('<title>Questions and answers · Stakeward</title>');
  expect(html).toContain('<link rel="canonical" href="https://dev.stakeward.com/learn/faq" />');
  expect(html).toContain('<meta name="robots" content="noindex" />');

  const robots = await request.get('/robots.txt');
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).not.toContain('Sitemap:');
  // No sitemap on devnet: the address falls through to the app.
  expect((await request.get('/sitemap.xml')).headers()['content-type']).toContain('text/html');

  await mockApi(page, SMOKE_FIXTURE);
  await page.goto('/learn/faq');
  await expect(page).toHaveTitle('Questions and answers · Stakeward');
  await page.getByRole('navigation', { name: 'Details' }).getByRole('link', { name: 'Costs' }).click();
  await expect(page).toHaveTitle('What it costs · Stakeward');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://dev.stakeward.com/learn/costs');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Stakeward is free\./);
});
