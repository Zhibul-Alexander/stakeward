import { ActionBar, Button, RiskNote } from '@stakeward/design-system';
import {
  ArrowDownToLineIcon,
  CalendarPlusIcon,
  FileTextIcon,
  InfoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldCheckIcon,
} from 'lucide-react';

/**
 * The hierarchy as /app shows it: one filled button for the page's goal (protect the accounts that need it), outline
 * for a row's action, ghost for Refresh. Row and group actions are `sm`.
 */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm">
      <ShieldCheckIcon aria-hidden="true" />
      Protect 2 accounts
    </Button>
    <Button size="sm" variant="outline">
      <CalendarPlusIcon aria-hidden="true" />
      Extend
    </Button>
    <Button size="icon-sm" variant="ghost" aria-label="Refresh">
      <RefreshCwIcon aria-hidden="true" />
    </Button>
  </div>
);

/** `danger` replaces primary when the action removes protection; its risk stands right above it. */
export const Danger = () => (
  <div className="flex flex-col items-start gap-3">
    <RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />
    <Button variant="danger">Review lock removal</Button>
  </div>
);

/** sm in rows, md by default, lg for the landing's two ways in, icon-sm for Refresh, copy and explorer. */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline">
      <ArrowDownToLineIcon aria-hidden="true" />
      Withdraw
    </Button>
    <Button size="md" variant="outline">
      Back to your accounts
    </Button>
    <Button size="lg">Check my stake</Button>
    <Button size="icon-sm" variant="ghost" aria-label="Refresh">
      <RefreshCwIcon aria-hidden="true" />
    </Button>
  </div>
);

/** A leading icon says what the button opens: the next steps after protecting, one filled button between them. */
export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button className="h-auto min-h-10 max-w-full whitespace-normal">
      <SendIcon aria-hidden="true" />
      Open Telegram bot
    </Button>
    <Button variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
      <FileTextIcon aria-hidden="true" />
      Open recovery card
    </Button>
  </div>
);

/**
 * A step that cannot go on yet: the step button turns outline with `aria-disabled` (it still takes a click, which names
 * every problem) and the first problem stands under it in muted text; Back stays ghost.
 */
export const NotReadyYet = () => (
  <ActionBar
    primary={
      <Button
        variant="outline"
        aria-disabled="true"
        aria-describedby="step-blockers"
        className="aria-disabled:pointer-events-auto aria-disabled:opacity-100"
      >
        Use this second key
      </Button>
    }
    reason={
      <div id="step-blockers" tabIndex={-1} className="flex items-start gap-2 rounded-md text-sm text-muted">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <p>Connect your second key to continue.</p>
        </div>
      </div>
    }
    secondary={<Button variant="ghost">Back</Button>}
  />
);

/** A check in progress: the button is `disabled` and its icon turns while the network answers. */
export const Busy = () => (
  <Button variant="outline" disabled>
    <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
    Check again
  </Button>
);
