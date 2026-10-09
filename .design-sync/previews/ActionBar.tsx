import { ActionBar, Button, RiskNote } from '@stakeward/design-system';
import { InfoIcon } from 'lucide-react';

// 10 April 2027 00:00 UTC: the end core's lockupEndForPeriod gives a 6-month lock under the fixed clock (9 October
// 2026), the date RadioCardGroup's LockPeriod shows for the protect wizard's default.
const LOCK_END = 1_807_315_200n;

/** Protect, review and sign: the hint, then the risk with its date right above the one filled button, and Back. */
export const SignWithRisk = () => (
  <div className="flex flex-col gap-3">
    <p className="text-sm text-muted">Check the summary above, then approve the request in Sample Wallet.</p>
    <ActionBar
      risk={<RiskNote risk="lose-second-key" date={LOCK_END} variant="inline" />}
      primary={
        <Button size="lg" className="h-auto min-h-12 max-w-full whitespace-normal text-balance">
          Sign 2 transactions in Sample Wallet as Main key
        </Button>
      }
      secondary={
        <Button variant="ghost" className="h-auto min-h-10 max-w-full whitespace-normal">
          Back
        </Button>
      }
    />
  </div>
);

/** Protect, second key step not done yet: the step button turns outline and says why under it, before any click. */
export const Blocked = () => (
  <ActionBar
    primary={
      <Button variant="outline" aria-disabled="true" className="aria-disabled:pointer-events-auto aria-disabled:opacity-100">
        Use this second key
      </Button>
    }
    reason={
      <div className="flex items-start gap-2 rounded-md text-sm text-muted">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <p>Connect your second key to continue.</p>
        </div>
      </div>
    }
    secondary={<Button variant="ghost">Back</Button>}
  />
);

/** Extend, with "Remove the lock now" chosen: the danger risk, who signs, and the one filled button turns danger. */
export const RemoveLock = () => (
  <ActionBar
    risk={<RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />}
    note="Your second key signs. In a phone wallet it needs a little SOL for the fee."
    primary={<Button variant="danger">Review lock removal</Button>}
  />
);

/** Withdraw: the risk carries its way out (Rescue) under it, above the one filled button. */
export const Withdraw = () => (
  <ActionBar
    risk={
      <RiskNote risk="withdraw-compromised" variant="inline">
        <p>
          <a href="#rescue" className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
            Rescue your stake instead
          </a>
        </p>
      </RiskNote>
    }
    primary={<Button>Review withdrawal</Button>}
  />
);

/** Page not found: the way on (check your stake) and the start page as the alternative. */
export const WithAlternative = () => (
  <ActionBar primary={<Button>Check your stake</Button>} secondary={<Button variant="ghost">Go to the start page</Button>} />
);
