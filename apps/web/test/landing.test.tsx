// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '@/App';

// The landing page "/" (CLAUDE.md section 9; section 10 step 8: three steps, FAQ, honest limits, wallets, Ledger),
// rendered in the whole site frame so header and footer count too. e2e/smoke.spec.ts checks the same page in Chromium
// under the production CSP: 360 px, axe in both themes, and Enter on every question.

/** The words of the stake program that the interface keeps to the FAQ answers (UX rule 4). */
const PROGRAM_WORDS = /custodian|withdrawer|staker/i;

function renderLanding() {
  const { hook, searchHook } = memoryLocation({ path: '/', static: true });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <App />
    </Router>,
  );
}

function faqItems(): HTMLDetailsElement[] {
  return [...document.querySelectorAll<HTMLDetailsElement>('details[data-slot="faq-item"]')];
}

function summaryOf(item: HTMLDetailsElement): HTMLElement {
  const summary = item.firstElementChild;
  if (!(summary instanceof HTMLElement) || summary.localName !== 'summary') throw new Error(`no summary first in ${item.id}`);
  return summary;
}

function answerOf(item: HTMLDetailsElement): HTMLElement {
  const answer = item.querySelector<HTMLElement>('[data-slot="faq-answer"]');
  if (answer === null) throw new Error(`no answer in ${item.id}`);
  return answer;
}

function faqItem(id: string): HTMLDetailsElement {
  const item = faqItems().find((candidate) => candidate.id === `faq-${id}`);
  if (item === undefined) throw new Error(`no question faq-${id}`);
  return item;
}

/** jsdom has no scrollIntoView: record which elements asked for it. */
function stubScrollIntoView(): { scrolled: Element[]; restore: () => void } {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const scrolled: Element[] = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(this: Element) {
      scrolled.push(this);
    },
  });
  return {
    scrolled,
    restore: () => {
      if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      else Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor);
    },
  };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('landing page', () => {
  it('has one h1, headings in order and says what Stakeward is', () => {
    renderLanding();
    const headings = screen.getAllByRole('heading');
    const levels = headings.map((heading) => Number(heading.localName.slice(1)));
    expect(headings.filter((heading) => heading.localName === 'h1').map((heading) => heading.textContent)).toEqual([
      'Protect your staked SOL',
    ]);
    expect(levels[0]).toBe(1);
    // Never deeper than one level below the heading before it.
    levels.forEach((level, index) => {
      if (index > 0) expect(level, headings[index]?.textContent ?? '').toBeLessThanOrEqual((levels[index - 1] ?? 1) + 1);
    });

    const hero = screen.getByRole('region', { name: 'Protect your staked SOL' });
    expect(hero).toHaveTextContent('network-level lock on the stake accounts you already have');
    for (const claim of ['Non-custodial', 'No program of its own', 'Free']) {
      expect(within(hero).getByText(claim)).toBeVisible();
    }
    // CLAUDE.md section 1: never a "2FA wallet".
    expect(document.body.textContent).not.toMatch(/2fa|two-factor/i);
  });

  it('sends its one action to /app, where looking needs no wallet, and never asks for the seed phrase', () => {
    renderLanding();
    expect(screen.getByRole('link', { name: 'Check your stake' })).toHaveAttribute('href', '/app');
    expect(screen.getByText(/^No wallet needed to look/)).toBeVisible();
    expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeVisible();
  });

  it('shows how it works in three steps, with the keys named as everywhere else (UX rule 4)', () => {
    renderLanding();
    const how = screen.getByRole('region', { name: 'How it works' });
    const steps = within(how).getAllByRole('listitem');
    expect(steps.map((step) => step.dataset['step'])).toEqual(['choose', 'lock', 'alerts']);
    expect(within(how).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Pick the stake and a second key',
      'Both keys sign the lock',
      'Alerts, and Rescue if needed',
    ]);
    steps.forEach((step, index) => {
      expect(step).toHaveTextContent(`Step ${String(index + 1)}`);
    });
    expect(steps[0]).toHaveTextContent('different seed phrase');
    expect(steps[1]).toHaveTextContent('an end date and your second key');
    expect(steps[2]).toHaveTextContent('Telegram');
    expect(steps[2]).toHaveTextContent('Rescue');
    // The scheme of role chips: the three names, exactly.
    const schemes = how.querySelectorAll('[data-slot="step-scheme"]');
    expect(schemes).toHaveLength(3);
    const roles = [...how.querySelectorAll('[data-role]')].map((chip) => chip.textContent);
    expect(new Set(roles)).toEqual(new Set(['Main key', 'Second key', 'New wallet']));
  });

  it('keeps #cannot-do, the section every footer links to, with the honest limits', () => {
    renderLanding();
    const section = document.getElementById('cannot-do');
    expect(section).not.toBeNull();
    expect(section).toBe(screen.getByRole('region', { name: 'What Stakeward cannot do' }));
    expect(within(section as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent('What Stakeward cannot do');
    expect(screen.getByRole('contentinfo')).toContainElement(screen.getByRole('link', { name: 'What Stakeward cannot do' }));
    expect(screen.getByRole('link', { name: 'What Stakeward cannot do' })).toHaveAttribute('href', '/#cannot-do');

    const text = section?.textContent ?? '';
    // CLAUDE.md section 1 and README "What no one can undo".
    expect(text).toContain('The second key can freeze your stake.');
    expect(text).toContain('If you lose the second key, you wait.');
    expect(text).toContain('The second key is not a backup of the main key.');
    expect(text).toContain('stop the staking, stake with another validator, split the stake account and change who manages staking');
    expect(text).toContain('When the lock ends, so does the protection.');
    expect(text).toContain('Two keys from one seed phrase protect nothing.');
    // Out of scope.
    const notCovered = within(section as HTMLElement).getByRole('heading', { level: 3, name: 'Not covered' });
    const list = notCovered.parentElement?.querySelector('ul');
    expect([...(list?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'Liquid staking tokens (LSTs)',
      'Stake held on an exchange',
      'Validator vote accounts',
      'SOL in your wallet balance',
    ]);
  });

  it('every question is a native disclosure that Tab reaches, in order, and that opens to its answer', async () => {
    renderLanding();
    const user = userEvent.setup();
    const items = faqItems();
    expect(items.length).toBeGreaterThanOrEqual(12);
    const summaries = items.map(summaryOf);

    // The browser opens a <details> when Enter or Space activates its first <summary>; e2e/smoke.spec.ts presses Enter
    // on each in Chromium. Here: each question is in the Tab order (summary of its details, nothing taking it out) ...
    const reached: string[] = [];
    for (let presses = 0; presses < 200 && reached.length < summaries.length; presses += 1) {
      await user.tab();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && summaries.includes(focused)) reached.push(focused.parentElement?.id ?? '');
    }
    expect(reached).toEqual(items.map((item) => item.id));

    // ... and activating it (what Enter and Space do) shows the answer, closed until then.
    for (const item of items) {
      const answer = answerOf(item);
      expect(item.open, item.id).toBe(false);
      expect(answer, item.id).not.toBeVisible();
      await user.click(summaryOf(item));
      expect(item.open, item.id).toBe(true);
      expect(answer, item.id).toBeVisible();
    }
    await user.click(summaryOf(faqItem('wallets')));
    expect(faqItem('wallets').open).toBe(false);
  });

  it('uses the program words custodian and withdrawer only inside FAQ answers (UX rule 4)', () => {
    renderLanding();
    const answers = faqItems().map(answerOf);
    // Positive control: the answer about the lock maps the roles to the command line's names.
    expect(answerOf(faqItem('lock')).textContent).toMatch(/custodian/);
    expect(answerOf(faqItem('lock')).textContent).toMatch(/withdrawer/);

    const page = document.body.cloneNode(true) as HTMLElement;
    for (const answer of page.querySelectorAll('[data-slot="faq-answer"]')) answer.remove();
    expect(page.querySelectorAll('[data-slot="faq-answer"]')).toHaveLength(0);
    expect(answers.length).toBe(faqItems().length);
    // Text and every attribute (accessible names too).
    expect(page.textContent).not.toMatch(PROGRAM_WORDS);
    const attributes = [...page.querySelectorAll('*')].flatMap((element) => [...element.attributes].map((a) => a.value));
    expect(attributes.filter((value) => PROGRAM_WORDS.test(value))).toEqual([]);
  });

  it('says what is known about wallets and Ledger, and that the wallet tests are not done yet', async () => {
    renderLanding();
    const user = userEvent.setup();
    for (const id of ['wallets', 'ledger', 'phone', 'cost']) await user.click(summaryOf(faqItem(id)));

    const wallets = answerOf(faqItem('wallets'));
    expect(wallets).toHaveTextContent('Wallet Standard');
    expect(wallets).toHaveTextContent('If the wallet changed it, Stakeward stops and sends nothing.');
    expect(wallets).toHaveTextContent('Lighthouse');
    expect(wallets).toHaveTextContent('Testing with real wallets is not finished yet.');

    const ledger = answerOf(faqItem('ledger'));
    expect(ledger).toHaveTextContent('New authority');
    expect(ledger).toHaveTextContent('When you withdraw, the Ledger does not show the second key.');
    expect(ledger).toHaveTextContent('it has not been tried on a real Ledger yet');

    expect(answerOf(faqItem('phone'))).toHaveTextContent('has not been tested yet');

    // The deposit of a link-signing account as the network has it (DECISIONS D22), not the 0.0015 of CLAUDE.md.
    const cost = answerOf(faqItem('cost'));
    expect(cost).toHaveTextContent('about 0.000005 SOL for each signature');
    expect(cost).toHaveTextContent('about 0.00106 SOL');
    expect(document.body.textContent).not.toMatch(/0\.0015/);
  });

  it('the thief answer leads to Rescue, a page of this site, in this tab', async () => {
    renderLanding();
    const user = userEvent.setup();
    await user.click(summaryOf(faqItem('thief')));
    const rescue = within(answerOf(faqItem('thief'))).getByRole('link', { name: 'Rescue your stake' });
    expect(rescue).toHaveAttribute('href', '/rescue');
    expect(rescue).not.toHaveAttribute('target');
  });

  it('opens the recovery guide on GitHub in a new tab that gets neither this page nor its address', async () => {
    renderLanding();
    const user = userEvent.setup();
    await user.click(summaryOf(faqItem('disappear')));
    const guide = within(answerOf(faqItem('disappear'))).getByRole('link', {
      name: 'Recover without Stakeward: the guide on GitHub (opens in a new tab)',
    });
    expect(guide).toHaveAttribute('href', 'https://github.com/Zhibul-Alexander/stakeward#recover-without-stakeward');
    expect(guide).toHaveAttribute('target', '_blank');
    expect(guide).toHaveAttribute('rel', 'noopener noreferrer');

    // Every link that leaves the site does the same.
    const external = [...document.querySelectorAll('main a[href^="http"]')];
    expect(external.length).toBeGreaterThanOrEqual(2);
    for (const link of external) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link.getAttribute('aria-label')).toMatch(/\(opens in a new tab\)$/);
    }
  });

  it('scrolls to the section a link points at, /#cannot-do from any footer, and opens a question it points at', () => {
    const scroll = stubScrollIntoView();
    try {
      window.history.replaceState(null, '', '/#cannot-do');
      const first = renderLanding();
      expect(scroll.scrolled).toHaveLength(1);
      expect(scroll.scrolled[0]).toBe(document.getElementById('cannot-do'));
      first.unmount();

      scroll.scrolled.length = 0;
      window.history.replaceState(null, '', '/#faq-wallets');
      renderLanding();
      expect(scroll.scrolled).toHaveLength(1);
      expect(scroll.scrolled[0]).toBe(faqItem('wallets'));
      expect(faqItem('wallets').open).toBe(true);
      expect(faqItem('ledger').open).toBe(false);
    } finally {
      scroll.restore();
    }
  });

  it('does not scroll when there is no fragment', () => {
    const scroll = stubScrollIntoView();
    try {
      renderLanding();
      expect(scroll.scrolled).toEqual([]);
    } finally {
      scroll.restore();
    }
  });
});
