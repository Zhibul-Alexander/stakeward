import { cn } from 'cn';
import type { ComponentProps } from 'react';

// shadcn/ui input, classes rewritten to design tokens. text-base on small screens keeps mobile browsers from zooming.
function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
