import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@stakeward/design-system';

// A DS state only: no product screen opens a tooltip. With asChild the trigger is the child element itself (a button
// or a link), so it keeps its own look and focus; hover or focus opens the tooltip (shown open with defaultOpen).

/** asChild on an outline Button: the button is the trigger. */
export const TextButton = () => (
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

function TextLink({ open }: { open: boolean }) {
  return (
    <TooltipProvider>
      <div className="flex justify-center py-12">
        <p className="text-sm">
          A{' '}
          <Tooltip defaultOpen={open}>
            <TooltipTrigger asChild>
              <a
                href="#tooltip"
                onClick={(event) => {
                  event.preventDefault();
                }}
                className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                link in a sentence
              </a>
            </TooltipTrigger>
            <TooltipContent>Tooltips repeat information that is also on the page.</TooltipContent>
          </Tooltip>{' '}
          can be a trigger too.
        </p>
      </div>
    </TooltipProvider>
  );
}

/** asChild on a text link inside a sentence: the link stays underlined and is the trigger. */
export const AsChildLink = () => <TextLink open />;

/** The same trigger closed: at rest only the link shows; nothing extra is in the page. */
export const Closed = () => <TextLink open={false} />;
