import { SupportBadge } from '@stakeward/design-system';
import { CircleQuestionMarkIcon } from 'lucide-react';

const linkClass = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/** Every verdict of the wallet matrix: word, colour and icon together; every pair starts at Not verified yet. */
export const EveryVerdict = () => (
  <div className="flex flex-wrap items-center gap-2">
    <SupportBadge verdict="not-verified" />
    <SupportBadge verdict="works" />
    <SupportBadge verdict="works-with-warning" />
    <SupportBadge verdict="blind-signing" />
    <SupportBadge verdict="does-not-work" />
  </div>
);

/**
 * "Which wallets work" on the landing, with the matrix as it stands: one pair tested, in one browser after a wallet
 * warning, by link not yet; so the note to try a small stake first stays above the list.
 */
export const WalletPairs = () => (
  <section aria-labelledby="wallets-title" className="flex flex-col gap-3 sm:gap-4">
    <div className="flex max-w-prose flex-col gap-1 sm:gap-2">
      <h2 id="wallets-title" className="text-lg font-semibold text-balance sm:text-2xl">
        Which wallets work
      </h2>
      <p className="text-sm text-pretty text-muted sm:text-base">
        So far only Phantom has been tested. Solflare, Backpack and Ledger have not been tested yet.
      </p>
    </div>
    <p className="text-sm text-muted">Tested on Solana devnet on 8 October 2026.</p>
    <p role="note" className="flex max-w-prose items-start gap-2 text-sm font-medium">
      <CircleQuestionMarkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
      Until a pair says Works, try a small stake first.
    </p>
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
      <li className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <h3 className="text-base font-semibold text-pretty">Phantom and Phantom, an account imported from another seed phrase</h3>
          <dl className="flex flex-wrap gap-x-4 gap-y-2 text-sm lg:shrink-0">
            <div className="flex items-center gap-2">
              <dt className="text-muted">In one browser</dt>
              <dd>
                <SupportBadge verdict="works-with-warning" />
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted">By link</dt>
              <dd>
                <SupportBadge verdict="not-verified" />
              </dd>
            </div>
          </dl>
        </div>
        <p className="text-sm text-muted">
          Phantom warns that each of these transactions could steal your funds in the future: it says so about any transaction
          that gives a key a role in an account. Check the keys on the Stakeward signing screen, then confirm.
        </p>
      </li>
    </ul>
    <div className="flex max-w-2xl flex-col gap-2 text-sm">
      <p className="text-pretty">
        In a phone wallet's browser: check, extend or remove a lock, and co-sign. Protect and rescue on a computer.
      </p>
      <p>
        <a href="#faq-ledger" className={linkClass}>
          What will my Ledger show?
        </a>
      </p>
    </div>
  </section>
);

/** In a column narrower than the badge, the longest verdict wraps onto two lines instead of overflowing. */
export const Wrapping = () => (
  <div style={{ width: 160 }}>
    <SupportBadge verdict="works-with-warning" />
  </div>
);
