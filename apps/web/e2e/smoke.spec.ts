import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { readStaticHeaders } from '../static-headers.ts';
import { expect, test } from './fixtures.ts';
import { MAIN, mockApi, NOW, rememberOnDevice, SECOND, SMOKE_FIXTURE, SMOKE_STAKE } from './mock-api.ts';
import { recordScreenMetrics } from './screen-metrics.ts';
import { text } from './texts.ts';

/**
 * Every route of the site under the production headers (CLAUDE.md sections 9, 11 and 13; step 8 spec 12.3), with the
 * worker's API mocked (e2e/mock-api.ts). One test walks every route, so the Playwright suite stays at 10 tests or
 * fewer as routes are added. It runs on the devnet build (`pnpm e2e`) and on the mainnet build that prod serves
 * (`pnpm e2e:mainnet`, E2E_CLUSTER=mainnet). With UPDATE_SCREENS=1 the devnet run writes each route's screen to
 * docs/screens/<screen>-{1280,360}.png.
 */
const CLUSTER = process.env['E2E_CLUSTER'] === 'mainnet' ? 'mainnet' : 'devnet';
const DEVNET = CLUSTER === 'devnet';
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';
const STATIC_HEADERS = readStaticHeaders();
const SOURCE_CODE_URL = 'https://github.com/Zhibul-Alexander/stakeward';

type SmokeRoute = {
  path: string;
  /** The page's h1. */
  heading: string;
  /** A stake account page: the h2 that shows it has read the account and says what can be done. */
  ready?: string | undefined;
  /** What else the route must show once it has read what it needs (before the overflow check, axe and the screen). */
  shows?: ((page: Page) => Promise<void>) | undefined;
  /** Checks that change the page, after axe and the screen. */
  after?: ((page: Page) => Promise<void>) | undefined;
  /** The route reads nothing from the API (a page that needs no wallet and no chain read to say what it says). */
  noApi?: boolean | undefined;
  /**
   * The page checks the cluster clock against this device's clock (extend, SECURITY-CHECK П12): the browser's clock is
   * fixed at the mocked cluster time (NOW) first, as a real device's would roughly agree. It stays fixed for the routes
   * after it.
   */
  clusterTime?: boolean | undefined;
  screen?: string | undefined;
};

/** Writes docs/screens/<name>-<width>.png, on the devnet build with UPDATE_SCREENS=1 only. */
async function screenshot(page: Page, name: string) {
  if (DEVNET) await recordScreenMetrics(page, name);
  if (!UPDATE_SCREENS || !DEVNET) return;
  mkdirSync(SCREENS_DIR, { recursive: true });
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${SCREENS_DIR}${name}-${String(width)}.png`, fullPage: true, animations: 'disabled' });
}

async function bodyColours(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { color: style.color, background: style.backgroundColor };
  });
}

/**
 * The landing page: the hero's answer and its one button in the first screen, the three steps, the limits, the network
 * and the way to the details (one link per /learn tab).
 */
async function landingShows(page: Page) {
  await expect(page.locator('#how-it-works ol > li')).toHaveCount(3);
  await expect(page.locator('#cannot-do')).toBeVisible();
  await expect(page.locator('#learn-more-title + ul a')).toHaveCount(5);
  const network = page.locator('[data-slot="network"]');
  await expect(network).toContainText(text(DEVNET ? 'landing.network.devnet' : 'landing.network.mainnet'));
  await expect(network).not.toContainText(text(DEVNET ? 'landing.network.mainnet' : 'landing.network.devnet'));
  // The first screen answers what this is and offers the one main button without scrolling (D112: at 360 px its
  // bottom stands above 740 px). Below 640 px the title is one line of text-2xl (32 px).
  const checkStake = page.getByRole('main').getByRole('link', { name: text('landing.checkStake') }).first();
  await expect(checkStake).toHaveAttribute('data-variant', 'primary');
  await expect(checkStake).toBeInViewport();
  const viewport = page.viewportSize();
  const buttonBox = await checkStake.boundingBox();
  expect(buttonBox).not.toBeNull();
  if (viewport !== null && viewport.width < 640) {
    expect((buttonBox?.y ?? Infinity) + (buttonBox?.height ?? 0)).toBeLessThan(740);
    const titleBox = await page.getByRole('heading', { level: 1, name: text('landing.title') }).boundingBox();
    expect(titleBox?.height ?? Infinity).toBeLessThanOrEqual(32);
  }
  if (DEVNET) await recordScreenMetrics(page, 'landing-initial');
  const layout = await page.evaluate(() => {
    const main = document.querySelector('main');
    const all = (selector: string) => [...(main?.querySelectorAll(selector) ?? [])];
    const size = (element: Element) => parseFloat(getComputedStyle(element).fontSize);
    return {
      smallestH2: Math.min(...all('h2').map(size)),
      largestH3: Math.max(...all('h3').map(size)),
      cannotDoPanel: getComputedStyle(all('#cannot-do ul')[0] ?? document.body).backgroundColor,
    };
  });
  expect(layout.largestH3).toBeLessThanOrEqual(layout.smallestH2);
  expect(layout.cannotDoPanel).not.toBe('rgba(0, 0, 0, 0)');
}

/**
 * /learn/faq: the questions folded into five groups; then every disclosure open, so the overflow check, axe in both
 * themes and the screenshot cover all of its text. The type holds its levels: an FAQ group's name outsizes its
 * questions, and an answer keeps a reading measure.
 */
async function learnFaqShows(page: Page) {
  const groups = page.locator('#faq details[data-slot="faq-group"]');
  await expect(groups).toHaveCount(5);
  for (const group of await groups.all()) await expect(group).not.toHaveAttribute('open');
  const questions = page.locator('main details');
  await questions.evaluateAll((items) => {
    for (const item of items) (item as HTMLDetailsElement).open = true;
  });
  const layout = await page.evaluate(() => {
    const main = document.querySelector('main');
    const all = (selector: string) => [...(main?.querySelectorAll(selector) ?? [])];
    const size = (element: Element) => parseFloat(getComputedStyle(element).fontSize);
    return {
      smallestGroup: Math.min(...all('[data-slot="faq-group"] > summary h3').map(size)),
      largestQuestion: Math.max(...all('[data-slot="faq-item"] > summary').map(size)),
      widestAnswer: Math.max(...all('[data-slot="faq-item"] > div').map((answer) => answer.getBoundingClientRect().width)),
    };
  });
  expect(layout.smallestGroup).toBeGreaterThan(layout.largestQuestion);
  expect(layout.widestAnswer).toBeLessThanOrEqual(720);
}

/**
 * Deep links: the footer's `/#cannot-do` followed from another page (a fresh load) shows that section on `/`; an old
 * `/#faq-ledger` link goes to /learn/faq, where its question and its group open and it is shown.
 */
async function landingDeepLinks(page: Page) {
  await page.goto('/stats');
  await page.goto('/#cannot-do');
  await expect(page.locator('#cannot-do')).toBeInViewport();
  await page.goto('/#faq-ledger');
  await expect(page).toHaveURL(/\/learn\/faq#faq-ledger$/);
  const ledger = page.locator('#faq-ledger');
  await expect(ledger).toHaveAttribute('open', '');
  await expect(page.locator('details[data-slot="faq-group"]:has(#faq-ledger)')).toHaveAttribute('open', '');
  await expect(ledger).toBeInViewport();
}

/** The printable part of an A4 sheet inside the card's @page margin of 14 mm (src/index.css), in CSS px. */
const A4_PRINTABLE = { width: Math.floor(((210 - 2 * 14) / 25.4) * 96), height: Math.floor(((297 - 2 * 14) / 25.4) * 96) };

/**
 * The recovery card printed on A4 by Chromium. A block that must not break (break-inside: avoid) but is taller than a
 * sheet is pushed to a new sheet and split anyway, which leaves a sheet nearly empty or a heading alone on one. So:
 * every such block fits a sheet, no heading may end a sheet, and the PDF has at most one sheet more than the card's
 * height needs.
 */
async function recoveryOnA4(page: Page) {
  const viewport = page.viewportSize();
  await page.setViewportSize(A4_PRINTABLE);
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  const layout = await page.evaluate((sheet) => {
    const card = document.querySelector('[data-slot="recovery-card"]');
    if (card === null) throw new Error('no recovery card');
    const name = (element: Element) => `${element.tagName.toLowerCase()}: ${element.textContent.trim().slice(0, 50)}`;
    return {
      tooTall: [card, ...card.querySelectorAll('*')]
        .filter((element) => getComputedStyle(element).breakInside === 'avoid' && element.getBoundingClientRect().height > sheet)
        .map(name),
      headingsThatMayEndASheet: [...card.querySelectorAll('h2, h3')].filter((heading) => getComputedStyle(heading).breakAfter !== 'avoid').map(name),
      height: document.documentElement.scrollHeight,
    };
  }, A4_PRINTABLE.height);
  expect(layout.tooTall).toEqual([]);
  expect(layout.headingsThatMayEndASheet).toEqual([]);
  // Each sheet is one `/Type /Page` object in the PDF (the page tree is `/Type /Pages`).
  const sheets = (await page.pdf({ format: 'A4' })).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  expect(sheets).toBeGreaterThan(0);
  expect(sheets).toBeLessThanOrEqual(Math.ceil(layout.height / A4_PRINTABLE.height) + 1);
  if (viewport !== null) await page.setViewportSize(viewport);
}

/**
 * The recovery card on paper: light whatever the reader's theme, without the site's header, footer, Print and Back,
 * with the commands, and on A4 sheets with no sheet wasted.
 */
async function recoveryPrint(page: Page) {
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
  const light = await bodyColours(page);
  const screenOnly: Locator[] = [
    page.getByRole('banner', { includeHidden: true }),
    page.getByRole('contentinfo', { includeHidden: true }),
    page.getByRole('button', { name: text('recovery.print'), includeHidden: true }),
    page.getByRole('main').getByRole('link', { name: text('common.backToAccounts'), includeHidden: true }),
  ];
  for (const part of screenOnly) await expect(part).toBeVisible();

  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  for (const part of screenOnly) await expect(part).toBeHidden();
  expect(await bodyColours(page)).toEqual(light);
  await expect(page.locator('[data-slot="command-block"]').first()).toBeVisible();
  await screenshot(page, 'recovery-print');
  await recoveryOnA4(page);
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
}

/** A page that does not exist: one way on (the accounts page), the start page as the alternative. */
async function notFoundShows(page: Page) {
  const main = page.getByRole('main');
  await expect(main.getByText(text('common.notFoundLink'))).toBeVisible();
  await expect(main.getByRole('link', { name: text('common.notFoundAction') })).toHaveAttribute('href', '/app');
  await expect(main.getByRole('link', { name: text('common.goHome') })).toHaveAttribute('href', '/');
}

/**
 * The site header's rows (its row container's children, by where they sit), its height, and how far its furthest
 * visible part passes the left and the right edge of the content column (the container inside its padding; 0 or less
 * is inside). Below 640 px the nav takes a second row by design (DECISIONS.md D112).
 */
async function headerLayout(page: Page) {
  return page.getByRole('banner').evaluate((header) => {
    // The row container spans the page with its padding; what counts is what it holds.
    const container = header.firstElementChild;
    if (container === null) throw new Error('empty header');
    const boxes = [...container.children].map((child) => child.getBoundingClientRect());
    let rows = 0;
    let rowBottom = -Infinity;
    for (const box of [...boxes].sort((a, b) => a.top - b.top)) {
      if (box.top >= rowBottom - 1) rows += 1;
      rowBottom = Math.max(rowBottom, box.bottom);
    }
    const frame = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    const contentLeft = frame.left + Number.parseFloat(style.paddingLeft);
    const contentRight = frame.right - Number.parseFloat(style.paddingRight);
    const visible = [...container.querySelectorAll('*')].map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0);
    return {
      rows,
      height: header.getBoundingClientRect().height,
      pastLeft: contentLeft - Math.min(...visible.map((box) => box.left)),
      pastRight: Math.max(...visible.map((box) => box.right)) - contentRight,
    };
  });
}

const NOT_FOUND = { heading: text('common.notFoundTitle'), shows: notFoundShows };

const ROUTES: readonly SmokeRoute[] = [
  { path: '/', heading: text('landing.title'), shows: landingShows, after: landingDeepLinks, screen: 'landing' },
  { path: '/app', heading: text('app.title') },
  { path: '/learn/faq', heading: text('learn.title'), shows: learnFaqShows, noApi: false },
  {
    path: '/learn/costs',
    heading: text('learn.title'),
    // The fees with the deposit read from the network.
    shows: async (page) => {
      await expect(page.locator('#fees')).toContainText('0.00105664 SOL');
    },
  },
  {
    path: '/learn/safety',
    heading: text('learn.title'),
    // No recovery link breaks inside its label.
    shows: async (page) => {
      const broken = await page.evaluate(() =>
        [...document.querySelectorAll('#recover a')].filter((link) => link.getClientRects().length !== 1).map((link) => link.textContent),
      );
      expect(broken).toEqual([]);
    },
  },
  {
    path: '/protect',
    heading: text('common.pages.protect'),
    // Step 1 of 5 asks for the main key; without it the wizard reads nothing from the network (UX rule 1).
    shows: async (page) => {
      await expect(page.getByRole('heading', { level: 2, name: text('protect.accounts.heading') })).toBeVisible();
      await expect(
        page.getByRole('button', { name: text('components.walletSlot.connectAs', { role: text('common.roles.main') }) }),
      ).toBeVisible();
      // The wizard's steps reach assistive technology at every width: below 640 px the list is screen-reader text next
      // to a line and a bar, never display: none (D112), and still marks where you are.
      const current = page
        .getByRole('navigation', { name: text('components.steps.label') })
        .getByRole('listitem')
        .filter({ hasText: `${text('components.steps.current')} ${text('protect.steps.accounts')}` });
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('aria-current', 'step');
    },
    noApi: true,
    screen: 'protect-start',
  },
  {
    path: `/withdraw/${SMOKE_STAKE}`,
    heading: text('common.pages.withdraw'),
    ready: text('withdraw.ready.title', { amount: '1,250.5 SOL' }),
    screen: 'withdraw',
  },
  {
    path: `/extend/${SMOKE_STAKE}`,
    heading: text('common.pages.extend'),
    ready: text('extend.legend'),
    clusterTime: true,
    screen: 'extend',
  },
  {
    // Telegram's "Open Rescue" lands here with the main key filled in: step 1 reads its stake with no wallet.
    path: `/rescue?address=${MAIN}`,
    heading: text('common.pages.rescue'),
    shows: async (page) => {
      await expect(page.getByRole('heading', { level: 2, name: text('rescue.stake.heading') })).toBeVisible();
      // The answer first: what is locked, its SOL and until when (DECISIONS.md D112).
      await expect(page.getByText(text('rescue.stake.safeUntil', { count: 1, amount: '1,250.5 SOL', date: '10 April 2027' }))).toBeVisible();
      await expect(page.locator('[data-slot="rescue-movable"] article[data-slot="account-row"]')).toHaveCount(1);
    },
    screen: 'rescue-start',
  },
  {
    // One-tap rescue kits (D118): the rescue wizard in kit mode, step 1 with the main key filled in.
    path: `/rescue-kit?address=${MAIN}`,
    heading: text('common.pages.rescueKit'),
    shows: async (page) => {
      await expect(page.getByRole('heading', { level: 2, name: text('rescue.stake.heading') })).toBeVisible();
    },
  },
  {
    // Where a one-tap rescue kit stands: its new owner in full; sending happens in the linked Telegram chat.
    path: `/rescue-kit/${SMOKE_STAKE}`,
    heading: text('common.pages.rescueNow'),
    shows: async (page) => {
      await expect(page.getByText(text('rescueKit.now.ready'))).toBeVisible();
    },
  },
  {
    // A broken link: said before anything is read or asked (step 7 spec 8.3).
    path: '/cosign#tx=@@',
    heading: text('common.pages.cosign'),
    shows: async (page) => {
      await expect(page.getByRole('heading', { name: text('cosign.bad.title') })).toBeVisible();
    },
    noApi: true,
    screen: 'cosign-broken',
  },
  {
    // "Try to steal it" (D123): the account read with no wallet; the simulation runs only on the button.
    path: `/try-steal/${SMOKE_STAKE}`,
    heading: text('common.pages.steal'),
    ready: text('steal.heading'),
  },
  {
    // The card of the smoke stake's pair of keys, read from the network with no wallet.
    path: `/recovery/${SMOKE_STAKE}`,
    heading: text('recovery.title'),
    shows: async (page) => {
      await expect(page.locator('[data-slot="recovery-account"]')).toHaveCount(1);
      // The card is how people recover without Stakeward: its commands and its devnet note follow this build's network.
      const urls = await page
        .locator('[data-slot="command-block"] pre')
        .evaluateAll((blocks) => blocks.flatMap((block) => [...block.textContent.matchAll(/--url\s+(\S+)/g)].map((match) => match[1])));
      expect(urls.length).toBeGreaterThan(0);
      expect(new Set(urls)).toEqual(new Set([DEVNET ? 'devnet' : 'mainnet-beta']));
      await expect(page.getByText(text('recovery.devnet'), { exact: true })).toHaveCount(DEVNET ? 1 : 0);
    },
    after: recoveryPrint,
    screen: 'recovery',
  },
  {
    // The public proof of the smoke main key's stake (D124): read from the network with no wallet, never "Protected".
    path: `/proof/${MAIN}`,
    heading: text('proof.title'),
    shows: async (page) => {
      await expect(page.getByText(text('proof.headline', { locked: '1,250.5', total: '1,250.5' }), { exact: true })).toBeVisible();
      await expect(page.locator('article[data-slot="account-row"]')).toHaveAttribute('data-status', 'locked-by-other');
      await expect(page.getByText(text('proof.limits'), { exact: true })).toBeVisible();
    },
    screen: 'proof',
  },
  {
    path: '/stats',
    heading: text('stats.title'),
    shows: async (page) => {
      await expect(page.getByRole('definition')).toHaveText(['12', '1,234 SOL', '7']);
    },
    screen: 'stats',
  },
  {
    // Check a transaction (D126): decoding is local, so the page asks the API for nothing.
    path: '/check',
    heading: text('check.title'),
    shows: async (page) => {
      await expect(page.getByText(text('check.local'))).toBeVisible();
      await expect(page.getByRole('heading', { name: text('check.emptyTitle') })).toBeVisible();
    },
    noApi: true,
    screen: 'check',
  },
  { path: '/demo', heading: text('demo.title'), noApi: true, screen: 'demo' },
  { path: '/no-such-page', ...NOT_FOUND, noApi: true, screen: 'not-found' },
  // The devnet-only pages are not in a mainnet build (on devnet, dev-ui.spec.ts and dev-cosign.spec.ts cover them).
  ...(DEVNET ? [] : [{ path: '/dev/ui', ...NOT_FOUND }, { path: '/dev/cosign', ...NOT_FOUND }]),
];

test('every route renders under the production headers, without console errors or axe violations', async ({
  page,
  expectNoA11yViolations,
}) => {
  // Each page is checked by axe in two themes; the landing page with every FAQ answer open is the longest.
  test.setTimeout(20_000 * ROUTES.length);
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const width = viewport.width;
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await mockApi(page, SMOKE_FIXTURE);
  // This device protected the stake, so it knows the second key (the account row reads Protected, not someone else's).
  await rememberOnDevice(page, { secondKeys: [SECOND] });

  for (const route of ROUTES) {
    await test.step(route.path, async () => {
      await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
      apiRequests.length = 0;
      if (route.clusterTime === true) await page.clock.setFixedTime(new Date(Number(NOW) * 1000));
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      const headers = response?.headers() ?? {};
      for (const [name, value] of Object.entries(STATIC_HEADERS)) {
        expect(headers[name.toLowerCase()], name).toBe(value);
      }

      await expect(page.getByRole('heading', { level: 1, name: route.heading, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: text('nav.home') })).toBeVisible();
      // Rescue and the accounts page from every page, in words at every width.
      const nav = page.getByRole('banner').getByRole('navigation', { name: text('nav.label') });
      await expect(nav.getByRole('link', { name: text('nav.rescue'), exact: true })).toHaveAttribute('href', '/rescue');
      await expect(nav.getByRole('link', { name: text('nav.app'), exact: true })).toHaveAttribute('href', '/app');
      const footer = page.getByRole('contentinfo');
      await expect(footer.getByText(text('footer.trust'))).toBeVisible();
      const source = footer.getByRole('link', { name: `${text('footer.sourceCode')} ${text('common.opensInNewTab')}`, exact: true });
      await expect(source).toHaveAttribute('href', SOURCE_CODE_URL);
      await expect(source).toHaveAttribute('target', '_blank');
      await expect(source).toHaveAttribute('rel', 'noreferrer');
      await expect(footer.getByRole('link', { name: text('footer.cannotDo') })).toHaveAttribute('href', '/#cannot-do');
      await expect(footer.getByRole('link', { name: text('footer.stats') })).toHaveAttribute('href', '/stats');
      await expect(footer.getByText(text('footer.license'))).toBeVisible();
      // The header says when the site works on the test network, and only then.
      const devnetBadge = page.getByRole('banner').getByText(text('common.devnet'), { exact: true });
      if (DEVNET) await expect(devnetBadge).toBeVisible();
      else await expect(devnetBadge).toHaveCount(0);
      // What devnet means, in words where there is room for them (768 px and up), never in a tooltip.
      const devnetNote = page.getByRole('banner').getByText(text('common.devnetNote'), { exact: true });
      if (DEVNET && width >= 768) await expect(devnetNote).toBeVisible();
      else await expect(devnetNote).toBeHidden();

      await route.shows?.(page);
      if (route.noApi === true) expect(apiRequests).toEqual([]);
      if (route.ready !== undefined) {
        // A stake account page reads its own account, never the search (step 6 spec 4.3).
        await expect(page.getByRole('heading', { level: 2, name: route.ready, exact: true })).toBeVisible();
        await expect(page.locator('article[data-slot="account-row"]')).toHaveAttribute('data-status', 'protected');
        expect(apiRequests.filter((url) => new URL(url).pathname === '/api/stake-accounts')).toEqual([]);
      }

      // Works at 360 px: nothing wider than the viewport.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      // The header: at 360 px two rows at most and 104 px tall at most; one row from 640 px. At every width nothing,
      // not even a link's box (the current page's pill, the focus ring), leaves the content column: at 360 px that is
      // the 16 px gutter on each side.
      const header = await headerLayout(page);
      if (width < 640) {
        expect(header.rows).toBeLessThanOrEqual(2);
        expect(header.height).toBeLessThanOrEqual(104);
      } else {
        expect(header.rows).toBe(1);
      }
      expect(header.pastLeft).toBeLessThanOrEqual(0.5);
      expect(header.pastRight).toBeLessThanOrEqual(0.5);
      if (route === ROUTES[0] && width >= 640) {
        await page.setViewportSize({ width: 640, height: 800 });
        expect((await headerLayout(page)).rows).toBe(1);
        await page.setViewportSize(viewport);
      }

      // Geist comes from the site itself (no CDN) and actually loads under the CSP.
      const geistLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some((face) => face.family.includes('Geist') && face.status === 'loaded');
      });
      expect(geistLoaded).toBe(true);

      // WCAG AA in both themes (tokens.css switches on prefers-color-scheme).
      await page.emulateMedia({ colorScheme: 'light' });
      await expectNoA11yViolations();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectNoA11yViolations();

      if (route.screen !== undefined) {
        await page.emulateMedia({ colorScheme: 'light' });
        await screenshot(page, route.screen);
      }
      await route.after?.(page);
    });
  }
});
