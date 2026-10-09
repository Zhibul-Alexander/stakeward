import { Button, PageHeader, StepProgress } from '@stakeward/design-system';
import { PrinterIcon } from 'lucide-react';

const protectSteps = ['Accounts', 'Second key', 'Lock period', 'Review and sign'];
const rescueSteps = ['Your stake', 'New wallet', 'Signers', 'Move', 'Done'];

/** A wizard's header (/protect, step 1): the h1, its lead and the steps. Later steps drop the lead. */
export const Wizard = () => (
  <PageHeader
    title="Protect your stake"
    lead="Lock your stake with a second key you control. While it is locked, your main key alone cannot withdraw the SOL or give the stake away."
    progress={<StepProgress steps={protectSteps} current={0} />}
  />
);

/** Two meta lines under the lead (/rescue, step 1): where it works best and the seed-phrase line, then the steps. */
export const TwoMetaLines = () => (
  <PageHeader
    title="Rescue your stake"
    lead="Move your stake to a new wallet if someone may have your main key."
    meta={
      <>
        <p>Best on a desktop. Your main key and second key can also sign by link.</p>
        <p>Stakeward never asks for your seed phrase.</p>
      </>
    }
    progress={<StepProgress steps={rescueSteps} current={0} />}
  />
);

/**
 * Every slot but the steps (/recovery): back link, lead, when the card was read, and the page's one control, Print,
 * which is the screen's one filled button, with how to keep a file under it.
 */
export const BackAndAction = () => (
  <PageHeader
    title="Stakeward recovery card"
    lead="Print it and keep it with your second key. It holds only public addresses, never secrets."
    meta={<p>Read from the network on 9&nbsp;October&nbsp;2026,&nbsp;00:00&nbsp;UTC.</p>}
    back={{ href: '/app', label: 'Back to your accounts' }}
    action={
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
        <Button>
          <PrinterIcon aria-hidden="true" />
          Print this card
        </Button>
        <p className="text-xs text-muted sm:max-w-44 sm:text-right">To keep a file, choose Save as PDF when printing.</p>
      </div>
    }
  />
);

/** A title and one sentence: /app, where the address form follows right under it. */
export const TitleAndLead = () => (
  <PageHeader title="Your stake accounts" lead="Paste any wallet address to see its stake. Looking and connecting sign nothing." />
);

/** The smallest header (/withdraw): the h1 and the seed-phrase line, no lead. */
export const TitleAndMeta = () => <PageHeader title="Withdraw" meta={<p>Stakeward never asks for your seed phrase.</p>} />;
