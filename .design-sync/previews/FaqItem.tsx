import { FaqItem } from '@stakeward/design-system';
import { ChevronDownIcon } from 'lucide-react';

const linkClass = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/** Closed: one line with the question and a chevron; the answer opens from a click, Enter, Space or a #faq- link. */
export const Closed = () => (
  <FaqItem id="faq-lock-ends" question="What happens when the lock ends?">
    <p>It ends at 00:00 UTC on its end date. From then on your main key alone controls the stake again, as before.</p>
    <p>
      The lock does not renew itself. If you turned on alerts, Stakeward reminds you 30, 14, 7, 3, and 1 days before. Your
      second key can extend the lock any time before it ends. After it ends, protect the stake again in Stakeward.
    </p>
  </FaqItem>
);

/** Open: the chevron turns over and the answer keeps a reading measure, one paragraph per block, ending in its Rescue link. */
export const Open = () => (
  <FaqItem id="faq-main-stolen" question="My main key was stolen. What now?" defaultOpen>
    <p>
      Stay calm: while the lock holds, the thief cannot take the stake. They may still stop your staking or move it to another
      validator. They may also split it into many small stake accounts. Each part keeps the lock.
    </p>
    <p>
      Rescue before the lock ends: after that time the thief can withdraw. One rescue run moves at most 10 stake accounts, and
      Stakeward cannot move them all at once. If you need more time, or there are many, first extend the lock on each with
      your second key alone, then rescue them run by run.
    </p>
    <p>
      On a device you trust, make a new wallet with a new seed phrase and put about 0.01 SOL on it. Then open Rescue: your main
      key, your second key and the new wallet sign together, and the stake moves to the new wallet. Afterwards, stake it again
      from the new wallet.
    </p>
    <p>Do not send SOL to the stolen wallet: thieves' bots empty it within seconds.</p>
    <p>
      <a href="/rescue" className={linkClass}>
        Rescue your stake
      </a>
    </p>
  </FaqItem>
);

/** In its FAQ group on the landing (Costs, alerts and privacy, all four questions): the group draws the lines between rows. */
export const InGroup = () => (
  <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
    <details open className="group/faq-group px-4 sm:px-6">
      <summary className="summary-plain relative flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-sm py-2.5 pr-8 sm:py-3">
        <h3 className="text-base font-semibold text-pretty sm:text-lg">Costs, alerts and privacy</h3>
        <span className="sr-only text-sm text-muted tabular-nums sm:not-sr-only">4 questions</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="absolute top-1/2 right-0 size-4 -translate-y-1/2 text-muted transition-transform group-open/faq-group:rotate-180"
        />
      </summary>
      <div className="flex flex-col divide-y divide-border border-t border-border">
        <FaqItem id="faq-free" question="Is Stakeward really free?" defaultOpen>
          <p>
            Yes. You pay only Solana network fees, and Stakeward gets none of them. There is no token, and Stakeward takes no
            payment in crypto. Protection, alerts, withdrawing and rescue stay free.
          </p>
        </FaqItem>
        <FaqItem id="faq-deposit" question="What is the link-signing deposit?">
          <p>
            Signing on another device needs a small helper account that keeps the transaction valid until the other device
            signs, even hours later. The network asks for 0.00144768 SOL to keep it open, and your wallet gets it back when
            you close the account. Every rescue uses one.
          </p>
        </FaqItem>
        <FaqItem id="faq-privacy" question="What does Stakeward know about me?">
          <p>
            Only public data. Stakeward's server keeps the public state of the stake accounts it watches and, if you turn on
            alerts, your Telegram chat id. There are no accounts, logins, email, cookies or analytics.
          </p>
          <p>
            Your browser remembers which wallet you used for each key and which stake accounts you protected, so it can warn
            you when a lock ends. That stays on your device.
          </p>
        </FaqItem>
        <FaqItem id="faq-stop-alerts" question="How do I stop alerts?">
          <p>Send /stop to the Stakeward bot in Telegram. It stops all alerts for that chat and forgets the chat.</p>
        </FaqItem>
      </div>
    </details>
  </div>
);
