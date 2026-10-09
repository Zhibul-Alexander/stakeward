import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@stakeward/design-system';

// A DS state only: no product screen opens a tooltip (App.tsx mounts the root TooltipProvider; only the design-system
// page shows one). Each story opens its tooltip (defaultOpen) so the bubble shows without hover, and brings its own
// provider. A tooltip repeats what the page already says: touch screens cannot hover.

/** Open on its trigger: short text above, the default side, with an arrow. */
export const Open = () => (
  <TooltipProvider>
    <div className="flex justify-center py-12">
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover or focus for a tooltip</Button>
        </TooltipTrigger>
        <TooltipContent>Tooltips repeat information that is also on the page.</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

/** Closed: at rest only the trigger shows; the bubble is not in the page. */
export const Closed = () => (
  <TooltipProvider>
    <div className="flex justify-center py-12">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover or focus for a tooltip</Button>
        </TooltipTrigger>
        <TooltipContent>Tooltips repeat information that is also on the page.</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

/** Longer text wraps at the bubble's max width. */
export const LongText = () => (
  <TooltipProvider>
    <div className="flex justify-center py-16">
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover or focus for a tooltip</Button>
        </TooltipTrigger>
        <TooltipContent>
          Tooltips repeat information that is also on the page. Touch screens cannot hover, so a tooltip never holds the
          only copy of anything.
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
