// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { getAddressDecoder } from '@solana/kit';
import { formatAlert, NONCE_ACCOUNT_SIZE, type Cluster } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { TestChain } from '@stakeward/core/test/svm';
import { render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { GATE_RESULTS_URL, README_RECOVERY_URL, SOURCE_CODE_URL } from '@/config';
import en from '@/i18n/en.json';
import { CosignPage } from '@/pages/CosignPage';
import { LandingPage } from '@/pages/LandingPage';
import { FAQ_GROUPS, type FaqId } from '@/pages/landing/faq.ts';
import { Wallets } from '@/pages/landing/Wallets.tsx';
import { LEDGER_CHECKED_ON, type PairSupport } from '@/pages/landing/wallet-support.ts';
import { PortsProvider } from '@/ports';
import { CountingChain } from './support/counting-chain.ts';
import { SCENARIO_TIMEOUT, testPorts, WAIT } from './support/stake-pages.tsx';

// The landing page `/` (step 8 spec 6, DECISIONS.md D79-D81) over a LiteSvmChain with the network's rent (5080
// lamports per byte, D22): the link-signing deposit for an 80-byte nonce account reads 0.00105664 SOL.

/** The link-signing deposit cannot be read (the RPC is down): the page says so in neutral words, with no error box. */
class FailingRentChain extends CountingChain {
  override getMinimumBalanceForRentExemption(size: number): Promise<bigint> {
    this.calls.push({ method: 'getMinimumBalanceForRentExemption', args: [size] });
    return Promise.reject(new Error('HTTP 503 Service Unavailable'));
  }
}

let lite: LiteSvmChain;

beforeAll(async () => {
  lite = new LiteSvmChain(await TestChain.create());
}, SCENARIO_TIMEOUT);

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView: the page calls it only when it exists (use-hash-target.ts).
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  scrollIntoView.mockClear();
  window.history.replaceState(null, '', '/');
});

function renderLanding({ chain = new CountingChain(lite), cluster = 'devnet' }: { chain?: CountingChain; cluster?: Cluster } = {}) {
  const location = memoryLocation({ path: '/', record: true });
  render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={testPorts(chain, [])}>
          <LandingPage cluster={cluster} />
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return { chain };
}

const section = (id: string) => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`no #${id}`);
  return found;
};

/** The deposit has been read: the FAQ answer that quotes it shows the amount. */
const DEPOSIT = '0.00105664 SOL';
const depositShown = () =>
  waitFor(() => {
    expect(section('fees')).toHaveTextContent(DEPOSIT);
  }, WAIT);

const ROLE_SYNONYMS = /\b(second wallet|main wallet|backup key|primary key|recovery key|co-?signer|guardian)\b/i;

describe('landing page structure', () => {
  it('has the hero, the three-step scheme, the thirteen limits, every section once and one primary button', async () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1, name: 'Protect your staked SOL' })).toBeInTheDocument();

    const steps = [...document.querySelectorAll('#how-it-works ol > li')];
    expect(steps.map((step) => step.querySelector('h3')?.textContent)).toEqual([
      'Lock it with a second key',
      'Get alerts',
      'Rescue or withdraw',
    ]);
    expect(section('cannot-do').querySelectorAll('li')).toHaveLength(13);
    expect(within(section('cannot-do')).getByRole('heading', { level: 2, name: 'What Stakeward cannot do' })).toHaveAttribute(
      'id',
      'cannot-do-title',
    );

    for (const id of ['why', 'how-it-works', 'protects', 'second-key', 'cannot-do', 'who', 'for-second-key', 'fees', 'wallets', 'alerts', 'security', 'recover', 'faq']) {
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1);
    }
    // No id twice anywhere (a link or aria-labelledby would find the first one).
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);

    // One main step per screen (UX rule 2): the final call is an outline button (spec L16).
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    await depositShown();
  });

  it('links only to targets that exist, to /app, and to the repository in a new tab', async () => {
    renderLanding();
    const hashLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(hashLinks.length).toBeGreaterThan(10);
    expect(hashLinks.map((link) => link.getAttribute('href')).filter((href) => document.getElementById((href ?? '#').slice(1)) === null)).toEqual([]);
    // The table of contents names each section by its own title.
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(toc).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#how-it-works',
      '#protects',
      '#second-key',
      '#cannot-do',
      '#fees',
      '#wallets',
      '#alerts',
      '#security',
      '#recover',
      '#faq',
    ]);
    expect(within(toc).getByRole('link', { name: 'Questions and answers' })).toHaveAttribute('href', '#faq');

    const checkStake = screen.getAllByRole('link', { name: 'Check your stake' });
    expect(checkStake).toHaveLength(2);
    for (const link of checkStake) expect(link).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: 'Open your recovery cards from your accounts' })).toHaveAttribute('href', '/app');

    const external = [
      ['Read the source code (opens in a new tab)', SOURCE_CODE_URL],
      ['Recovery guide on GitHub (opens in a new tab)', README_RECOVERY_URL],
      ['Test results in the repository (docs/gate.md) (opens in a new tab)', GATE_RESULTS_URL],
    ] as const;
    for (const [name, href] of external) {
      // `hidden`: the gate link sits in a closed FAQ answer.
      const link = screen.getByRole('link', { name, hidden: true });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
    // Every link to another site says it opens a new tab; every other link opens here.
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('aria-label')).toBe(`${link.textContent} ${en.common.opensInNewTab}`);
    }
    expect(document.querySelectorAll('a[target="_blank"]:not([href^="http"])')).toHaveLength(0);
    await depositShown();
  });
});

describe('landing fees', () => {
  it('shows the network fees from core and the deposit read from the network, once', async () => {
    const { chain } = renderLanding();
    const fees = section('fees');
    expect(fees).toHaveTextContent('The network charges 0.000005 SOL for each signature');
    for (const amount of ['0.0000106 SOL', '0.0000056 SOL', '0.0000156 SOL']) expect(fees).toHaveTextContent(amount);
    expect(fees).toHaveTextContent('If it has no SOL, your main key signs too and pays 0.0000106 SOL.');
    expect(fees).toHaveTextContent('If the stake is still staking, stopping it first costs 0.0000056 SOL.');

    await depositShown();
    expect(section('faq-deposit')).toHaveTextContent(`The network asks for ${DEPOSIT} to keep it open`);
    // The only network read of the page: rent for an 80-byte nonce account (StrictMode runs the effect twice).
    expect(chain.calls.length).toBeGreaterThan(0);
    expect(chain.calls.filter((call) => call.method !== 'getMinimumBalanceForRentExemption' || call.args[0] !== NONCE_ACCOUNT_SIZE)).toEqual([]);
  });

  it('says "a small amount set by the network" when the deposit cannot be read, with no error box', async () => {
    renderLanding({ chain: new FailingRentChain(lite) });
    await waitFor(() => {
      expect(section('fees')).toHaveTextContent('A small amount set by the network');
    }, WAIT);
    expect(section('faq-deposit')).toHaveTextContent('The network asks for a small deposit to keep it open');
    expect(screen.queryAllByRole('alert', { hidden: true })).toEqual([]);
    expect(document.body.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});

describe('landing network line', () => {
  it('on devnet: says it is the test version and offers the short test locks', async () => {
    renderLanding({ cluster: 'devnet' });
    expect(screen.getByText('Solana devnet')).toBeInTheDocument();
    expect(screen.getByText(en.landing.network.devnetNote)).toBeInTheDocument();
    expect(screen.getByText(en.landing.how.periodDevnet)).toBeInTheDocument();
    expect(screen.queryByText('Solana mainnet')).toBeNull();
    await depositShown();
  });

  it('on mainnet: real SOL, and no devnet line', async () => {
    renderLanding({ cluster: 'mainnet' });
    expect(screen.getByText('Solana mainnet')).toBeInTheDocument();
    expect(screen.getByText(en.landing.network.mainnetNote)).toBeInTheDocument();
    expect(screen.queryByText('Solana devnet')).toBeNull();
    expect(screen.queryByText(en.landing.network.devnetNote)).toBeNull();
    expect(screen.queryByText(en.landing.how.periodDevnet)).toBeNull();
    await depositShown();
  });
});

describe('landing wallet table', () => {
  it('claims nothing before the wallet matrix: the one Phantom pair is "Not verified yet", and the note says so', async () => {
    renderLanding();
    const wallets = section('wallets');
    // Only the pair the matrix runs (TESTPLAN step 3: two Phantom accounts; no Solflare, Backpack or Ledger to test).
    expect([...wallets.querySelectorAll('[data-pair]')].map((pair) => pair.getAttribute('data-pair'))).toEqual(['phantom+phantom-imported']);
    const verdicts = [...wallets.querySelectorAll('[data-verdict]')];
    expect(verdicts).toHaveLength(2);
    expect(new Set(verdicts.map((badge) => badge.textContent))).toEqual(new Set(['Not verified yet']));
    expect(within(wallets).getByRole('note')).toHaveTextContent(en.landing.wallets.notVerified);
    expect(within(wallets).getAllByText('Signing by link')).toHaveLength(1);
    expect(within(wallets).getAllByText('Both wallets in this browser')).toHaveLength(1);
    expect(
      within(wallets).getByRole('heading', { level: 3, name: 'Phantom and Phantom, an account imported from another seed phrase' }),
    ).toBeInTheDocument();
    // The wallets that are not in the table are named as untested.
    expect(wallets).toHaveTextContent('Solflare, Backpack and Ledger have not been tested yet.');
    expect(wallets).not.toHaveTextContent('Tested on Solana devnet');
    await depositShown();
  });

  it('promises no test that is not planned and claims none that has not run (UX rule П10)', async () => {
    renderLanding();
    expect(document.body.textContent).not.toMatch(/still testing|what we have tested|on a device yet|not tested yet/i);
    // The Ledger is known from its Solana app's source code only: every answer that leans on it says so.
    expect(section('faq-ledger')).toHaveTextContent('Stakeward has not been tested with a Ledger.');
    expect(section('faq-good-second-key')).toHaveTextContent('Stakeward has not been tested with a Ledger');
    expect(section('faq-fake-site')).toHaveTextContent("source code of Ledger's Solana app, not from a test on a device");
    await depositShown();
  });

  const filled: PairSupport = { id: 'phantom+solflare', main: 'phantom', second: 'solflare', here: 'works', link: 'works-with-warning', note: 'phantom-first' };

  it('shows a matrix run as data: the verdicts, the note and the date, without the not-verified note', () => {
    render(<Wallets pairs={[filled]} checkedOn="2026-10-06" />);
    const pair = document.querySelector('[data-pair="phantom+solflare"]') as HTMLElement;
    expect(within(pair).getByRole('heading', { level: 3, name: 'Phantom and Solflare' })).toBeInTheDocument();
    expect(within(pair).getByText('Works')).toBeInTheDocument();
    expect(within(pair).getByText('Works, with a wallet warning')).toBeInTheDocument();
    expect(within(pair).getByText(en.landing.wallets.notes['phantom-first'])).toBeInTheDocument();
    expect(screen.getByText('Tested on Solana devnet on 6 October 2026.')).toBeInTheDocument();
    expect(screen.queryByText(en.landing.wallets.notVerified)).toBeNull();
  });

  it('keeps the not-verified note while any verdict is open or the date is not a date', () => {
    const { unmount } = render(<Wallets pairs={[filled, { ...filled, id: 'phantom+backpack', second: 'backpack', link: 'not-verified' }]} checkedOn="2026-10-06" />);
    expect(screen.getByText(en.landing.wallets.notVerified)).toBeInTheDocument();
    unmount();
    render(<Wallets pairs={[filled]} checkedOn="6.10.2026" />);
    expect(screen.getByText(en.landing.wallets.notVerified)).toBeInTheDocument();
    expect(screen.queryByText(/Tested on Solana devnet/)).toBeNull();
  });
});

describe('landing FAQ', () => {
  it('asks every question once, each a <details> named faq-<id> with its question as the summary', async () => {
    renderLanding();
    const items = Object.keys(en.faq.items) as FaqId[];
    const grouped = FAQ_GROUPS.flatMap((group) => group.items);
    expect([...grouped].sort()).toEqual([...items].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const id of items) {
      const item = section(`faq-${id}`);
      expect(item.tagName, id).toBe('DETAILS');
      expect(item.querySelector('summary')?.textContent, id).toBe(en.faq.items[id].q);
      // One paragraph per blank-line block of the answer.
      expect(item.querySelectorAll(':scope > div > p').length, id).toBeGreaterThanOrEqual(en.faq.items[id].a.split('\n\n').length);
    }
    expect(within(section('faq')).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(
      FAQ_GROUPS.map((group) => en.faq.groups[group.id]),
    );
    await depositShown();
  });

  it('the stolen main key answer leads to Rescue, a page of this site, in this tab', async () => {
    renderLanding();
    // `hidden`: the answer sits in a closed <details>.
    const rescue = within(section('faq-main-stolen')).getByRole('link', { name: 'Rescue your stake', hidden: true });
    expect(rescue).toHaveAttribute('href', '/rescue');
    expect(rescue).not.toHaveAttribute('target');
    await depositShown();
  });

  it('quotes the status a lock of an unknown key shows, and says that on a new device it is how your own lock looks', async () => {
    renderLanding();
    const { lockedByOther, lockedByAnother, protected: protectedLabel, expiring } = en.status;
    const unknownLock = section('faq-locked-by-other');
    expect(unknownLock.querySelector('summary')).toHaveTextContent(`Why does my stake account say ${lockedByOther}?`);
    expect(unknownLock).toHaveTextContent('On a new device or in another browser, your own lock looks like this');
    // Your own lock, once its key is connected, says Protected, or Expiring soon near its end: both are named.
    expect(unknownLock).toHaveTextContent(`then it says ${protectedLabel} or ${expiring}.`);
    // And what a browser that knows your second key calls a lock that key does not hold (D35).
    expect(unknownLock).toHaveTextContent(`a lock held by any other key says ${lockedByAnother} instead.`);
    // The fake-site check, made with the second key connected: your own key's statuses, and the one a fake site leaves.
    const fakeSite = section('faq-fake-site');
    expect(fakeSite).toHaveTextContent(`Each stake account you protected must say ${protectedLabel} or ${expiring}.`);
    expect(fakeSite).toHaveTextContent(`One that says ${lockedByAnother} is not locked by the key you connected.`);
    await depositShown();
  });

  it('lists what a Ledger should show, hedged until a device has shown it', async () => {
    renderLanding();
    const ledger = section('faq-ledger');
    expect([...ledger.querySelectorAll('h4')].map((heading) => heading.textContent)).toEqual([
      'Protect',
      'Extend or remove the lock',
      'Withdraw',
      'Rescue',
      'Set up signing by link',
    ]);
    const labels = [...ledger.querySelectorAll('dt')].map((term) => term.textContent);
    for (const label of ['New authority', 'Custodian', 'Create nonce acct']) expect(labels).toContain(label);
    expect(LEDGER_CHECKED_ON).toBeNull();
    expect(ledger).toHaveTextContent("This list comes from the source code of Ledger's Solana app, not from a device.");
    expect(ledger.querySelector('a[href="#faq-terms"]')).toHaveTextContent('What custodian, withdrawer and staker mean');
    expect(document.body.textContent).not.toContain('without blind signing');
    await depositShown();
  });
});

describe('landing words and numbers', () => {
  it('fills every placeholder, keeps the program words in the FAQ and uses one name per key role', async () => {
    renderLanding();
    await depositShown();
    expect(document.body.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(section('faq-lock-ends')).toHaveTextContent('Stakeward reminds you 30, 14, 7, 3, and 1 days before.');
    expect(section('alerts')).toHaveTextContent('the lock ends soon: 30, 14, 7, 3, and 1 days before, and when it ends');
    expect(section('faq-main-stolen')).toHaveTextContent('put about 0.01 SOL on it');
    expect(section('faq-cli')).toHaveTextContent('Solana CLI 4.3.0 refuses');

    // UX rule 4: custodian, withdrawer and staker only in the FAQ.
    const outsideFaq = document.body.cloneNode(true) as HTMLElement;
    outsideFaq.querySelector('#faq')?.remove();
    expect(outsideFaq.textContent).not.toMatch(/custodian|withdrawer|staker/i);
    expect(section('faq').textContent).toMatch(/custodian/i);
    // Never a 2FA wallet (CLAUDE.md section 1); no synonym for Main key, Second key, New wallet (D81).
    expect(document.body.textContent).not.toMatch(/\b2FA\b|two-factor/i);
    expect(document.body.textContent).not.toMatch(ROLE_SYNONYMS);
  });

  // SECURITY-CHECK П4, П8, П26: the honest limits the security check found, said before anyone protects a stake.
  it('says that a thief can split a locked stake and that a rescue run moves at most 10 accounts', async () => {
    renderLanding();
    await depositShown();
    expect(section('cannot-do')).toHaveTextContent(
      'It cannot stop a thief with your main key from splitting your stake into many small stake accounts. Each part keeps the lock, but a rescue moves at most 10 of them per run: act early, and extend the lock with your second key first.',
    );
    const mainStolen = section('faq-main-stolen');
    expect(mainStolen).toHaveTextContent('They may also split it into many small stake accounts. Each part keeps the lock.');
    expect(mainStolen).toHaveTextContent('One rescue run moves at most 10 stake accounts, and Stakeward cannot move them all at once.');
    expect(mainStolen).toHaveTextContent(
      'If you need more time, or there are many, first extend the lock on each with your second key alone, then rescue them run by run.',
    );
  });

  it('keeps the second key for Stakeward, and says how to check a lock without Stakeward', async () => {
    renderLanding();
    await depositShown();
    expect(section('faq-good-second-key')).toHaveTextContent(
      'Use your second key only to co-sign Stakeward transactions; do not connect it to other sites.',
    );
    const check = section('faq-check-explorer');
    expect(check.querySelector('summary')).toHaveTextContent('How can I check my lock without Stakeward?');
    expect(check).toHaveTextContent('Solana Explorer');
    // Explorer's own labels (solana-foundation/explorer StakeAccountSection): the lock is a "Lockup expires on" banner
    // shown only while it holds, the second key is "Lockup Authority Address", the main key "Withdraw Authority Address".
    // Explorer shows no "custodian" and no lockup section, so the FAQ never sends a user to look for one.
    expect(check).toHaveTextContent('Account is locked! Lockup expires on');
    expect(check).toHaveTextContent('Lockup Authority Address must be your second key');
    expect(check).toHaveTextContent('Withdraw Authority Address must be your main key');
    expect(check).toHaveTextContent('If that line is missing, your stake account is not locked.');
    expect(check.textContent).not.toMatch(/custodian/i);
  });

  it('promises "alerts, not SOL" only for a server that is down: the same server delivers this website', async () => {
    renderLanding();
    const security = section('security');
    // A server taken over (Cloudflare account, deploy token) is a website taken over: it can ask for harmful
    // signatures, as the next point says. Only a server that is down costs nothing but alerts.
    expect(security.textContent).not.toMatch(/hacked or down|down or hacked/i);
    const server = within(security).getByText(/you lose alerts, not SOL/);
    expect(server.textContent).toMatch(/If it is down, you lose alerts, not SOL\./);
    expect(server.textContent).toMatch(/The same server delivers this website/);
    await depositShown();
  });

  it('quotes the bot: the example alert is core formatAlert word for word, with its button', async () => {
    renderLanding();
    const decode = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
    const alert = formatAlert(
      { type: 'DEACTIVATED', details: { deactivationEpoch: '0' }, stakeAccount: decode(7) },
      { withdrawer: decode(8), lockUntil: 1n, now: 0n },
    );
    const figure = section('alerts').querySelector('figure') as HTMLElement;
    expect(figure.querySelector('figcaption')).toHaveTextContent('An alert looks like this');
    expect([...figure.querySelectorAll('p')].map((p) => p.textContent)).toEqual([alert.text]);
    expect(alert.text).toMatch(/^Stake \w{3}\.\.\.\w{3} was deactivated\. If this was not you, your main key may be stolen\. Your SOL cannot be withdrawn without the second key\.$/);
    expect(within(figure).getByText('Open Rescue')).toBeInTheDocument();
    // An example, not a control.
    expect(within(figure).queryByRole('button')).toBeNull();
    expect(within(figure).queryByRole('link')).toBeNull();
    await depositShown();
  });
});

describe('landing hash targets', () => {
  it('opens the FAQ question the address names and brings it into view', async () => {
    window.history.replaceState(null, '', '/#faq-ledger');
    renderLanding();
    const ledger = section('faq-ledger') as HTMLDetailsElement;
    expect(ledger.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollIntoView.mock.contexts).toContain(ledger);
    expect((section('faq-co-sign') as HTMLDetailsElement).open).toBe(false);

    // A later hash change on this page (a link inside the page) opens that question too.
    window.location.hash = 'faq-co-sign';
    await waitFor(() => {
      expect((section('faq-co-sign') as HTMLDetailsElement).open).toBe(true);
    }, WAIT);
    await depositShown();
  });

  it('scrolls to a section or card without opening anything, and ignores unknown or malformed hashes', async () => {
    window.history.replaceState(null, '', '/#for-second-key');
    renderLanding();
    expect(scrollIntoView.mock.contexts).toEqual(expect.arrayContaining([section('for-second-key')]));
    await depositShown();

    scrollIntoView.mockClear();
    window.history.replaceState(null, '', '/#%E0%A4%A');
    expect(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }).not.toThrow();
    window.history.replaceState(null, '', '/#no-such-id');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect([...document.querySelectorAll<HTMLDetailsElement>('#faq details')].filter((item) => item.open)).toEqual([]);
  });

  it('/cosign "What is Stakeward?" opens the landing at the card for whoever was sent a link', () => {
    const location = memoryLocation({ path: '/cosign', record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={testPorts(new CountingChain(lite), [])}>
          <CosignPage fragment="#tx=@@" />
        </PortsProvider>
      </Router>,
    );
    expect(screen.getByRole('link', { name: 'What is Stakeward?' })).toHaveAttribute('href', '/#for-second-key');
  });
});
