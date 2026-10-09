import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@stakeward/design-system';

// A DS state only: no product screen opens a tooltip. TooltipContent renders in a portal with an arrow, on the inverse
// surface, 4 px from its trigger; each story opens it (defaultOpen) inside its Tooltip.

function Sided({ side, children }: { side: 'top' | 'right' | 'bottom'; children: string }) {
  return (
    <TooltipProvider>
      <div className={side === 'right' ? 'flex py-12 pl-8' : 'flex justify-center py-16'}>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <Button variant="outline">Hover or focus for a tooltip</Button>
          </TooltipTrigger>
          <TooltipContent side={side}>{children}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/** On top, the default side. */
export const Top = () => <Sided side="top">Tooltips repeat information that is also on the page.</Sided>;

/** On the right of the trigger, the arrow pointing back at it. */
export const Right = () => <Sided side="right">Tooltips repeat information that is also on the page.</Sided>;

/** Below the trigger; longer text wraps at max-w-xs. */
export const Bottom = () => (
  <Sided side="bottom">
    Tooltips repeat information that is also on the page. Touch screens cannot hover, so a tooltip never holds the only
    copy of anything.
  </Sided>
);
