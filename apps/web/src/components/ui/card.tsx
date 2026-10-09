import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui card, classes rewritten to design tokens. CardTitle takes asChild so a page can make it a heading.
// A hairline frame and no shadow: shadows belong to floating layers only (the tooltip).
function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-surface py-4 text-foreground sm:py-6',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1 px-4 sm:px-6', className)} {...props} />;
}

function CardTitle({ className, asChild = false, ...props }: ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp data-slot="card-title" className={cn('text-lg font-semibold', className)} {...props} />;
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-sm text-muted', className)} {...props} />;
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4 sm:px-6', className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex flex-wrap items-center gap-2 border-t border-border px-4 pt-4 sm:px-6 sm:pt-6', className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
