import { cn } from 'cn';
import type { ComponentProps } from 'react';

// shadcn/ui skeleton, classes rewritten to design tokens. Decorative: the loading state is announced elsewhere.
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-md bg-subtle', className)} {...props} />
  );
}

export { Skeleton };
