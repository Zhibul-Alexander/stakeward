import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@stakeward/design-system';

// The app mounts one TooltipProvider at its root (App.tsx, the default 200 ms open delay), but no product screen opens a
// tooltip under it: the tooltips here are a DS state only. Every Tooltip below one provider shares its delay, and moving
// from one trigger to the next skips it.

function TwoTriggers({ open }: { open: 'first' | 'second' }) {
  return (
    <TooltipProvider>
      <div className="flex justify-center gap-3 py-12">
        <Tooltip defaultOpen={open === 'first'}>
          <TooltipTrigger asChild>
            <Button variant="outline">Hover here first</Button>
          </TooltipTrigger>
          <TooltipContent>Opens after the 200 ms delay.</TooltipContent>
        </Tooltip>
        <Tooltip defaultOpen={open === 'second'}>
          <TooltipTrigger asChild>
            <Button variant="outline">Then move here</Button>
          </TooltipTrigger>
          <TooltipContent>Opens at once, without the delay.</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/** One provider over two triggers; the first tooltip open. */
export const FirstOpen = () => <TwoTriggers open="first" />;

/** The same provider with the second tooltip open instead. */
export const SecondOpen = () => <TwoTriggers open="second" />;
