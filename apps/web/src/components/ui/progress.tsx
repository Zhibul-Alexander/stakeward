import { cn } from 'cn';
import { Progress as ProgressPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui progress, classes rewritten to design tokens. `value` also goes to the root so aria-valuenow is set
// (the shadcn original dropped it). The indicator moves through the style prop (CSSOM), which the CSP allows.
function Progress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const percent = Math.min(100, Math.max(0, value ?? 0));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-subtle', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full bg-primary transition-transform"
        style={{ transform: `translateX(-${String(100 - percent)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
